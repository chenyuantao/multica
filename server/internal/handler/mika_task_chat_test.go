package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestMikaTaskChatStartsAsThePerson(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	mika := createHandlerTestAgent(t, "mika-scheduler", nil)
	worker := createHandlerTestAgent(t, "Ada", nil)
	source := dbfx.Issue(t, "Cmd+O source")
	askID := dbfx.Comment(t, source, "帮我修待办页")
	taskID := createHandlerTestTaskForAgentOnIssue(t, mika, source)
	dbfx.Exec(t, `UPDATE agent_task SET trigger_comment_id = $1 WHERE id = $2`, askID, taskID)

	got := make(chan map[string]any, 1)
	testHandler.Bus.Subscribe(protocol.EventGroupChatUpdated, func(e events.Event) {
		payload, _ := e.Payload.(map[string]any)
		if payload["ask_comment_id"] == askID {
			select {
			case got <- payload:
			default:
			}
		}
	})

	req := groupChatRequestAs(t, testUserID, "POST", "/api/mika/task-chats", map[string]any{
		"title":            "待办页不刷新",
		"content":          "查一下切换后为什么不刷新",
		"mention_agent_id": worker,
	})
	req.Header.Set("X-Actor-Source", "task_token")
	req.Header.Set("X-Agent-ID", mika)
	req.Header.Set("X-Task-ID", taskID)

	var out struct {
		Chat struct {
			ID   string `json:"id"`
			Task bool   `json:"task"`
		} `json:"chat"`
		Message struct {
			AuthorType string `json:"author_type"`
			AuthorID   string `json:"author_id"`
			Content    string `json:"content"`
		} `json:"message"`
	}
	testutil.Call(t, testHandler.StartMikaTaskChat, req).Want(http.StatusCreated).JSON(&out)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(context.Background(), sql, out.Chat.ID)
		}
	})

	wantPrefix := "[@Ada](mention://agent/" + worker + ")"
	if out.Message.AuthorType != "member" || out.Message.AuthorID != testUserID || !strings.HasPrefix(out.Message.Content, wantPrefix) {
		t.Fatalf("message = %+v, want the person speaking and a leading mention of Ada", out.Message)
	}
	if !out.Chat.Task {
		t.Fatal("created chat is not a task chat")
	}

	select {
	case payload := <-got:
		if payload["issue_id"] != out.Chat.ID {
			t.Fatalf("event issue = %v, want %s", payload["issue_id"], out.Chat.ID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("task chat event did not carry the ask comment")
	}

	var queued int
	dbfx.QueryRow(t, `SELECT count(*) FROM agent_task WHERE agent_id = $1 AND issue_id = $2 AND status = 'queued'`, worker, out.Chat.ID).Scan(&queued)
	if queued != 1 {
		t.Fatalf("queued tasks for Ada = %d, want 1", queued)
	}
	var status string
	dbfx.QueryRow(t, `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status)
	if status != "running" {
		t.Fatalf("source task status = %s, want running when the caller is not Mika", status)
	}
}

func TestMikaTaskChatDoesNotDelegateToHerself(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	mika := markAsMika(t, createHandlerTestAgent(t, "Mika", nil))
	source := dbfx.Issue(t, "self delegation source")
	taskID := createHandlerTestTaskForAgentOnIssue(t, mika, source)

	for _, mention := range []string{mika, ""} {
		req := groupChatRequestAs(t, testUserID, "POST", "/api/mika/task-chats", map[string]any{
			"title":            "should not be created",
			"content":          "do the work",
			"mention_agent_id": mention,
		})
		req.Header.Set("X-Actor-Source", "task_token")
		req.Header.Set("X-Agent-ID", mika)
		req.Header.Set("X-Task-ID", taskID)
		resp := testutil.Call(t, testHandler.StartMikaTaskChat, req).Want(http.StatusBadRequest)
		if mention == mika && !strings.Contains(resp.Text(), mikaSelfDelegationError) {
			t.Fatalf("body = %s, want %s", resp.Text(), mikaSelfDelegationError)
		}
		if mention == "" && !strings.Contains(resp.Text(), mikaMentionRequiredError) {
			t.Fatalf("body = %s, want %s", resp.Text(), mikaMentionRequiredError)
		}
	}

	var status string
	dbfx.QueryRow(t, `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status)
	if status != "running" {
		t.Fatalf("source task status = %s, want running after a refused handoff", status)
	}
}

func TestMikaTaskChatEndsAfterHandoff(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	mika := markAsMika(t, createHandlerTestAgent(t, "Mika", nil))
	worker := createHandlerTestAgent(t, "Ada", nil)
	source := dbfx.Issue(t, "handoff source")
	taskID := createHandlerTestTaskForAgentOnIssue(t, mika, source)

	req := groupChatRequestAs(t, testUserID, "POST", "/api/mika/task-chats", map[string]any{
		"title":            "待办页不刷新",
		"content":          "查一下切换后为什么不刷新",
		"mention_agent_id": worker,
	})
	req.Header.Set("X-Actor-Source", "task_token")
	req.Header.Set("X-Agent-ID", mika)
	req.Header.Set("X-Task-ID", taskID)

	var out struct {
		Chat struct {
			ID string `json:"id"`
		} `json:"chat"`
	}
	testutil.Call(t, testHandler.StartMikaTaskChat, req).Want(http.StatusCreated).JSON(&out)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(context.Background(), sql, out.Chat.ID)
		}
	})

	var status, result string
	dbfx.QueryRow(t, `SELECT status, coalesce(result::text, '') FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status, &result)
	if status != "completed" || !strings.Contains(result, "Ada") {
		t.Fatalf("source task = %s %s, want completed and handed to Ada", status, result)
	}
	var queuedMika, queuedAda int
	dbfx.QueryRow(t, `SELECT count(*) FROM agent_task WHERE agent_id = $1 AND issue_id = $2 AND status = 'queued'`, mika, out.Chat.ID).Scan(&queuedMika)
	dbfx.QueryRow(t, `SELECT count(*) FROM agent_task WHERE agent_id = $1 AND issue_id = $2 AND status = 'queued'`, worker, out.Chat.ID).Scan(&queuedAda)
	if queuedMika != 0 || queuedAda != 1 {
		t.Fatalf("queued mika=%d ada=%d, want 0 and 1", queuedMika, queuedAda)
	}
}
