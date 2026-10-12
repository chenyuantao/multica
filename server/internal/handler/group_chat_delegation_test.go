package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

// TestGroupChatRunDoesNotDelegate locks the two enqueue doors a group-chat
// run used to open: creating or assigning an issue to another agent, and
// @mentioning that agent. The issue write still sticks. An agent running on
// an ordinary issue still starts the assignee.
func TestGroupChatRunDoesNotDelegate(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	agentA := createHandlerTestAgent(t, "gc-deleg-speaker", nil)
	agentB := createHandlerTestAgent(t, "gc-deleg-target", nil)

	var chat GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title": "delegation off",
		"members": []map[string]string{
			{"member_type": "agent", "member_id": agentA},
		},
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})

	taskID := createHandlerTestTaskForAgentOnIssue(t, agentA, chat.ID)
	dbfx.Exec(t, `UPDATE agent_task_queue SET originator_user_id = $1 WHERE id = $2`, testUserID, taskID)
	asSpeaker := func(method, path string, body any) *http.Request {
		req := newRequest(method, path, body)
		req.Header.Set("X-Agent-ID", agentA)
		req.Header.Set("X-Task-ID", taskID)
		return req
	}

	var child IssueResponse
	testutil.Call(t, testHandler.CreateIssue, asSpeaker("POST", "/api/issues", map[string]any{
		"title":         "write the article",
		"status":        "todo",
		"assignee_type": "agent",
		"assignee_id":   agentB,
	})).Want(http.StatusCreated).JSON(&child)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM agent_task_queue WHERE issue_id = $1`, child.ID)
		testPool.Exec(ctx, `DELETE FROM issue WHERE id = $1`, child.ID)
	})
	if child.AssigneeType == nil || *child.AssigneeType != "agent" || child.AssigneeID == nil || *child.AssigneeID != agentB {
		t.Fatalf("child assignee = %v %v, want agent %s", child.AssigneeType, child.AssigneeID, agentB)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, child.ID, agentB); n != 0 {
		t.Fatalf("group-chat create enqueued %d runs for the assignee, want 0", n)
	}
	if taskChat := issueIsTaskChat(t, child.ID); taskChat {
		t.Fatal("group-chat create filed a task chat; a chat run does not delegate")
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM issue_member WHERE issue_id = $1`, child.ID); n != 0 {
		t.Fatalf("group-chat create added %d members, want a board issue", n)
	}

	var parked IssueResponse
	testutil.Call(t, testHandler.CreateIssue, newRequest("POST", "/api/issues", map[string]any{
		"title":  "promote me",
		"status": "backlog",
	})).Want(http.StatusCreated).JSON(&parked)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM agent_task_queue WHERE issue_id = $1`, parked.ID)
		testPool.Exec(ctx, `DELETE FROM issue WHERE id = $1`, parked.ID)
	})
	testutil.Call(t, testHandler.UpdateIssue, withURLParam(asSpeaker("PATCH", "/api/issues/"+parked.ID, map[string]any{
		"assignee_type": "agent",
		"assignee_id":   agentB,
		"status":        "todo",
	}), "id", parked.ID)).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, parked.ID, agentB); n != 0 {
		t.Fatalf("group-chat assign enqueued %d runs, want 0", n)
	}

	postGroupChatAsAgent(t, chat.ID, agentA, taskID, map[string]any{
		"content": "[@Target](mention://agent/" + agentB + ") write it",
	})
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, chat.ID, agentB); n != 0 {
		t.Fatalf("group-chat mention enqueued %d runs, want 0", n)
	}

	var ordinary IssueResponse
	testutil.Call(t, testHandler.CreateIssue, newRequest("POST", "/api/issues", map[string]any{
		"title":  "ordinary parent",
		"status": "todo",
	})).Want(http.StatusCreated).JSON(&ordinary)
	ordinaryTask := createHandlerTestTaskForAgentOnIssue(t, agentA, ordinary.ID)
	dbfx.Exec(t, `UPDATE agent_task_queue SET originator_user_id = $1 WHERE id = $2`, testUserID, ordinaryTask)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM agent_task_queue WHERE issue_id = $1`, ordinary.ID)
		testPool.Exec(ctx, `DELETE FROM issue WHERE id = $1`, ordinary.ID)
	})
	req := newRequest("POST", "/api/issues", map[string]any{
		"title":         "still delegated quasarium",
		"status":        "todo",
		"assignee_type": "agent",
		"assignee_id":   agentB,
	})
	req.Header.Set("X-Agent-ID", agentA)
	req.Header.Set("X-Task-ID", ordinaryTask)
	var handed IssueResponse
	testutil.Call(t, testHandler.CreateIssue, req).Want(http.StatusCreated).JSON(&handed)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, handed.ID)
		}
	})
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, handed.ID, agentB); n != 1 {
		t.Fatalf("ordinary-issue create enqueued %d runs, want 1", n)
	}
	if !issueIsTaskChat(t, handed.ID) {
		t.Fatal("todo delegation was not filed as a task chat")
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM issue_member WHERE issue_id = $1 AND member_type = 'member' AND member_id = $2`, handed.ID, testUserID); n != 1 {
		t.Fatalf("originator memberships = %d, want the person who started the chain", n)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM issue_member WHERE issue_id = $1 AND member_type = 'agent' AND member_id = $2`, handed.ID, agentA); n != 1 {
		t.Fatalf("assigning-agent memberships = %d, want 1", n)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM issue_member WHERE issue_id = $1 AND member_type = 'agent' AND member_id = $2`, handed.ID, agentB); n != 1 {
		t.Fatalf("assignee memberships = %d, want 1", n)
	}
	listed := findChat(listChatsAs(t, testUserID), handed.ID)
	if listed == nil || !listed.Task || listed.Status != "todo" {
		t.Fatalf("chat list delegation = %+v, want a todo task chat", listed)
	}
	var found struct {
		Issues []IssueResponse `json:"issues"`
	}
	testutil.Call(t, testHandler.SearchIssues, newRequest("GET", "/api/issues/search?q=still+delegated+quasarium", nil)).Want(http.StatusOK).JSON(&found)
	for _, issue := range found.Issues {
		if issue.ID == handed.ID {
			t.Fatal("task chat appears in issue search")
		}
	}

	backlogReq := newRequest("POST", "/api/issues", map[string]any{
		"title":         "parked delegation quasarium",
		"status":        "backlog",
		"assignee_type": "agent",
		"assignee_id":   agentB,
	})
	backlogReq.Header.Set("X-Agent-ID", agentA)
	backlogReq.Header.Set("X-Task-ID", ordinaryTask)
	var parkedByAgent IssueResponse
	testutil.Call(t, testHandler.CreateIssue, backlogReq).Want(http.StatusCreated).JSON(&parkedByAgent)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM agent_task_queue WHERE issue_id = $1`, parkedByAgent.ID)
		testPool.Exec(ctx, `DELETE FROM issue WHERE id = $1`, parkedByAgent.ID)
	})
	if issueIsTaskChat(t, parkedByAgent.ID) {
		t.Fatal("backlog delegation was filed as a task chat")
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, parkedByAgent.ID, agentB); n != 0 {
		t.Fatalf("backlog delegation enqueued %d runs, want 0", n)
	}
	testutil.Call(t, testHandler.SearchIssues, newRequest("GET", "/api/issues/search?q=parked+delegation+quasarium", nil)).Want(http.StatusOK).JSON(&found)
	seen := false
	for _, issue := range found.Issues {
		if issue.ID == parkedByAgent.ID {
			seen = true
		}
	}
	if !seen {
		t.Fatal("backlog delegation missing from issue search")
	}
}

func issueIsTaskChat(t *testing.T, issueID string) bool {
	t.Helper()
	var taskChat bool
	dbfx.QueryRow(t, `SELECT is_task_chat FROM issue WHERE id = $1`, issueID).Scan(&taskChat)
	return taskChat
}
