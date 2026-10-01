package handler

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestGroupChatRunsOverlapUpToAgentConcurrency(t *testing.T) {
	ctx := context.Background()
	runtimeID := dbfx.Runtime(t, "chat concurrency runtime")
	agentID := dbfx.Agent(t, "chat concurrency agent", runtimeID)
	dbfx.Exec(t, `UPDATE agent SET max_concurrent_tasks = 2 WHERE id = $1`, agentID)

	var room GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   "Concurrency room",
		"members": []map[string]string{{"member_type": "agent", "member_id": agentID}},
	})).Want(http.StatusCreated).JSON(&room)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, room.ID)
		}
	})

	issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(room.ID))
	if err != nil {
		t.Fatal(err)
	}
	agent, err := testHandler.Queries.GetAgent(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatal(err)
	}
	enqueue := func(content string) {
		t.Helper()
		commentID := dbfx.Comment(t, room.ID, content)
		result := testHandler.enqueueCommentAgentTriggers(ctx, issue, parseUUID(commentID),
			[]commentAgentTrigger{{Agent: agent, Source: commentTriggerSourceMentionAgent}})
		if result[agentID].status != DispatchQueued {
			t.Fatalf("enqueue %q: got %+v, want queued", content, result[agentID])
		}
	}
	claim := db.ClaimAgentTaskParams{AgentID: parseUUID(agentID), RuntimeID: parseUUID(runtimeID), PrepareLeaseSecs: 60, RuntimeStaleSecs: 120}
	enqueue("first question")
	first, err := testHandler.Queries.ClaimAgentTask(ctx, claim)
	if err != nil {
		t.Fatal(err)
	}
	if first.ForceFreshSession {
		t.Fatal("the first run should keep its session")
	}
	dbfx.Exec(t, `UPDATE agent_task_queue SET status = 'running', started_at = now() WHERE id = $1`, uuidToString(first.ID))

	enqueue("second question")
	second, err := testHandler.Queries.ClaimAgentTask(ctx, claim)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || !second.ForceFreshSession {
		t.Fatalf("second claim = %+v, want a fresh overlapping run", second.ID)
	}

	dbfx.Exec(t, `UPDATE agent SET max_concurrent_tasks = 1 WHERE id = $1`, agentID)
	dbfx.Exec(t, `UPDATE agent_task_queue SET status = 'running', started_at = now() WHERE id = $1`, uuidToString(second.ID))
	enqueue("third question")
	if _, err := testHandler.Queries.ClaimAgentTask(ctx, claim); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("concurrency 1 still claimed a second run: %v", err)
	}
}
