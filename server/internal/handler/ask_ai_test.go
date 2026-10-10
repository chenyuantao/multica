package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/typesafe"
)

type askAIEvaluator struct {
	choice string
	state  groupchat.AskState
}

func (e *askAIEvaluator) Enabled() bool { return true }
func (e *askAIEvaluator) Evaluate(_ context.Context, state any, _ map[string]any) (map[string]typesafe.Answer, error) {
	e.state = state.(groupchat.AskState)
	return map[string]typesafe.Answer{"agent": {Type: "choice", Choice: e.choice}}, nil
}

func TestAskAIChoosesAgentFromQueryPageAndRoster(t *testing.T) {
	first := createHandlerTestAgent(t, "ask-ai-writer", nil)
	second := createHandlerTestAgent(t, "ask-ai-ops", nil)
	ev := &askAIEvaluator{choice: second}
	prev := testHandler.GroupChatDecider
	testHandler.GroupChatDecider = ev
	t.Cleanup(func() { testHandler.GroupChatDecider = prev })

	var out AskAIResponse
	testutil.Call(t, testHandler.AskAI, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/ask", map[string]any{
		"query": "  how do we deploy?  ",
		"page": map[string]any{
			"note": map[string]any{"title": "Runbook", "path": "ops/runbook.md", "modified_at": "2026-01-01T00:00:00Z", "content": "steps"},
		},
	})).Want(http.StatusOK).JSON(&out)

	if out.AgentID != second {
		t.Fatalf("agent_id = %q, want %q", out.AgentID, second)
	}
	if ev.state.Query != "how do we deploy?" || ev.state.Page == nil || ev.state.Page.Note == nil || ev.state.Page.Note.Path != "ops/runbook.md" {
		t.Fatalf("state = %+v", ev.state)
	}
	offered := map[string]bool{}
	for _, agent := range ev.state.Agents {
		offered[agent.ID] = true
	}
	if !offered[first] || !offered[second] {
		t.Fatalf("agents offered = %+v, want both test agents", ev.state.Agents)
	}

	ev.choice = "not-an-agent"
	testutil.Call(t, testHandler.AskAI, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/ask", map[string]any{
		"query": "hello",
	})).Want(http.StatusServiceUnavailable)
	testutil.Call(t, testHandler.AskAI, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/ask", map[string]any{
		"query": "   ",
	})).Want(http.StatusBadRequest)

	ev.choice = first
	testutil.Call(t, testHandler.AskAI, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/ask", map[string]any{
		"query":       "",
		"attachments": []map[string]string{{"name": "trace.log", "content_type": "text/plain"}},
		"page": map[string]any{
			"selection": map[string]any{"message_id": "m1", "sender": "Ann", "time": "t", "content": "it failed", "text": "failed"},
		},
	})).Want(http.StatusOK).JSON(&out)
	if out.AgentID != first || len(ev.state.Attachments) != 1 || ev.state.Attachments[0].Name != "trace.log" ||
		ev.state.Page == nil || ev.state.Page.Selection == nil || ev.state.Page.Selection.Text != "failed" {
		t.Fatalf("attachment-only ask: agent = %q, state = %+v", out.AgentID, ev.state)
	}
}

func TestAskOpensTheDirectChatAndSendsTheQuery(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "ask-dispatch-agent", nil)
	ev := &askAIEvaluator{choice: agentID}
	prev := testHandler.GroupChatDecider
	testHandler.GroupChatDecider = ev
	t.Cleanup(func() { testHandler.GroupChatDecider = prev })

	var first AskResponse
	testutil.Call(t, testHandler.Ask, groupChatRequestAs(t, testUserID, "POST", "/api/ask", map[string]any{
		"query": "  how do we ship this?  ",
		"page":  map[string]any{"note": map[string]any{"title": "Runbook", "path": "ops/runbook.md", "content": "steps"}},
	})).Want(http.StatusCreated).JSON(&first)
	if first.AgentID != agentID || first.Chat.ID == "" || !first.Chat.IsDirect || first.Message.Content != "how do we ship this?" {
		t.Fatalf("ask = %+v", first)
	}
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM comment_ask_context WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, first.Chat.ID)
		}
	})
	var tasks int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, first.Chat.ID, agentID).Scan(&tasks); err != nil {
		t.Fatal(err)
	}
	if tasks != 1 {
		t.Fatalf("queued tasks = %d, want the chosen agent started", tasks)
	}

	var second AskResponse
	testutil.Call(t, testHandler.Ask, groupChatRequestAs(t, testUserID, "POST", "/api/ask", map[string]any{
		"query": "and the rollback?",
	})).Want(http.StatusCreated).JSON(&second)
	if second.Chat.ID != first.Chat.ID || second.Message.Content != "and the rollback?" {
		t.Fatalf("second ask = %+v, want the same chat", second)
	}

	blocked := groupChatRequestAs(t, testUserID, "POST", "/api/ask", map[string]any{"query": "no"})
	blocked.Header.Set("X-Actor-Source", "task_token")
	testutil.Call(t, testHandler.Ask, blocked).Want(http.StatusForbidden)
	testutil.Call(t, testHandler.Ask, groupChatRequestAs(t, testUserID, "POST", "/api/ask", map[string]any{
		"query": "",
	})).Want(http.StatusBadRequest)
}

func TestAskAIContextReachesTheAnsweringAgentAsXML(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "ask-ai-context-agent", nil)
	var chat GroupChatResponse
	testutil.Call(t, testHandler.OpenDirectGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/direct", map[string]any{
		"member_type": "agent", "member_id": agentID,
	})).JSON(&chat)
	if chat.ID == "" {
		t.Fatal("direct chat was not opened")
	}
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM comment_ask_context WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})

	var msg CommentResponse
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chat.ID+"/comments", map[string]any{
		"content": "what does this mean?",
		"ask_ai": map[string]any{
			"note":      map[string]any{"title": "Runbook", "path": "ops/runbook.md", "content": "a < b"},
			"selection": map[string]any{"message_id": "m1", "sender": "Ann", "time": "t", "content": "deploy failed", "text": "failed"},
		},
	}), "id", chat.ID)).Want(http.StatusCreated).JSON(&msg)

	issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(chat.ID))
	if err != nil {
		t.Fatal(err)
	}
	resp := AgentTaskResponse{GroupChatTranscript: "<group_chat/>"}
	testHandler.attachAskAIContext(ctx, &resp, issue, db.AgentTaskQueue{TriggerCommentID: parseUUID(msg.ID)})
	for _, want := range []string{
		"<group_chat/>\n\n<ask_ai_context message_id=\"" + msg.ID + "\">",
		`<note title="Runbook" path="ops/runbook.md">a &lt; b</note>`,
		"<highlight>failed</highlight>",
	} {
		if !strings.Contains(resp.GroupChatTranscript, want) {
			t.Fatalf("transcript missing %q:\n%s", want, resp.GroupChatTranscript)
		}
	}
	if strings.Contains(msg.Content, "ask_ai_context") {
		t.Fatalf("the context leaked into the visible message: %q", msg.Content)
	}
}

func TestAskAIContextHidesChatMessagesTheAgentDoesNotNeed(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "ask-ai-filter-agent", nil)
	var chat GroupChatResponse
	testutil.Call(t, testHandler.OpenDirectGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/direct", map[string]any{
		"member_type": "agent", "member_id": agentID,
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM comment_ask_context WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})

	var msg CommentResponse
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chat.ID+"/comments", map[string]any{
		"content": "what failed in the deploy?",
		"ask_ai": map[string]any{
			"chat": map[string]any{
				"title":  "Launch",
				"agents": []string{"Ops"},
				"messages": []map[string]string{
					{"id": "m-lunch", "time": "t1", "sender": "Ann", "content": "lunch plans"},
					{"id": "m-deploy", "time": "t2", "sender": "Ann", "content": "deploy failed"},
				},
			},
			"selection": map[string]string{"message_id": "m-deploy", "time": "t2", "sender": "Ann", "content": "deploy failed"},
		},
	}), "id", chat.ID)).Want(http.StatusCreated).JSON(&msg)

	ev := &groupChatFilterEvaluator{choice: "屏蔽"}
	prev := testHandler.GroupChatDecider
	testHandler.GroupChatDecider = ev
	t.Cleanup(func() { testHandler.GroupChatDecider = prev })

	issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(chat.ID))
	if err != nil {
		t.Fatal(err)
	}
	var resp AgentTaskResponse
	testHandler.attachAskAIContext(ctx, &resp, issue, db.AgentTaskQueue{
		AgentID:          parseUUID(agentID),
		TriggerCommentID: parseUUID(msg.ID),
	})
	xml := resp.GroupChatTranscript
	if strings.Contains(xml, "lunch plans") || !strings.Contains(xml, ">"+groupchat.HiddenMessageText+"</msg>") || !strings.Contains(xml, `id="m-lunch"`) {
		t.Fatalf("unrelated on-screen message was not hidden:\n%s", xml)
	}
	if !strings.Contains(xml, "deploy failed") || !strings.Contains(xml, `id="m-deploy"`) {
		t.Fatalf("the message being asked about was hidden:\n%s", xml)
	}
	if len(ev.questions) != 1 {
		t.Fatalf("questions = %d, want only the unrelated message", len(ev.questions))
	}
	sawQuestion := false
	for _, message := range ev.state.Messages {
		if message.Content == "what failed in the deploy?" {
			sawQuestion = true
		}
	}
	if !sawQuestion {
		t.Fatalf("the question was not in the filter state: %+v", ev.state.Messages)
	}
}
