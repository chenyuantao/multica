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
}
