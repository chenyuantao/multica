package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestCreateComment_TriggeredTaskRejectsTopLevelComment exercises the full
// CreateComment handler path (not just taskCoversReplyParent) for the trap
// reported in MUL-4417 / GH #5266: a comment-triggered task that posts a
// parentless, top-level comment on its own issue is rejected with a 409 whose
// message names the trigger comment and states that top-level comments are not
// allowed. Pinning the message here keeps it from silently drifting away from
// the behavior the CLI help now documents.
func TestCreateComment_TriggeredTaskRejectsTopLevelComment(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	fx := newRunningSquadLeaderTaskFixture(t)

	w := httptest.NewRecorder()
	r := newRequest("POST", "/api/issues/"+fx.IssueID+"/comments", map[string]any{
		"content": "dispatching a squad from this task",
	})
	r = withURLParam(r, "id", fx.IssueID)
	r.Header.Set("X-Agent-ID", fx.LeaderID)
	r.Header.Set("X-Task-ID", fx.TaskID)

	testHandler.CreateComment(w, r)
	if w.Code != http.StatusConflict {
		t.Fatalf("CreateComment top-level: expected 409, got %d: %s", w.Code, w.Body.String())
	}
	if got := countAgentCommentsForIssue(t, fx.IssueID, fx.LeaderID); got != 0 {
		t.Fatalf("expected rejected top-level comment not to be stored, got %d", got)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	msg, _ := body["error"].(string)
	// Pin the three semantic pieces without locking the exact wording: why it
	// was rejected, the comment to reply under, and the actionable fix. The last
	// one guards against the guidance being dropped in a future edit.
	for _, want := range []string{
		"top-level comments",   // reason
		fx.TriggerCommentID,    // the comment to reply under
		"parent_id (--parent)", // actionable fix
	} {
		if !strings.Contains(msg, want) {
			t.Fatalf("409 message should contain %q, got %q", want, msg)
		}
	}
}

// TestCreateComment_TriggeredTaskAllowsReplyUnderTrigger is the positive half:
// the same task replying under its trigger comment succeeds, proving the guard
// rejects only the top-level case and does not lock the whole issue for
// comments (MUL-4417 / GH #5266).
func TestCreateComment_TriggeredTaskAllowsReplyUnderTrigger(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	fx := newRunningSquadLeaderTaskFixture(t)

	w := httptest.NewRecorder()
	r := newRequest("POST", "/api/issues/"+fx.IssueID+"/comments", map[string]any{
		"content":   "replying under the trigger comment",
		"parent_id": fx.TriggerCommentID,
	})
	r = withURLParam(r, "id", fx.IssueID)
	r.Header.Set("X-Agent-ID", fx.LeaderID)
	r.Header.Set("X-Task-ID", fx.TaskID)

	testHandler.CreateComment(w, r)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateComment reply-under-trigger: expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

// TestCreateComment_GroupChatMessagesAreTopLevel: a group chat is never
// threaded. A triggered task may post without --parent, and a parent passed by
// an agent or a person is dropped.
func TestCreateComment_GroupChatMessagesAreTopLevel(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	fx := newRunningSquadLeaderTaskFixture(t)
	if _, err := testPool.Exec(ctx, `
		INSERT INTO issue_member (issue_id, workspace_id, member_type, member_id)
		VALUES ($1, $2, 'agent', $3)
	`, fx.IssueID, testWorkspaceID, fx.LeaderID); err != nil {
		t.Fatalf("make the issue a group chat: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM issue_member WHERE issue_id = $1`, fx.IssueID) })

	post := func(body map[string]any, asAgent bool) string {
		t.Helper()
		w := httptest.NewRecorder()
		r := withURLParam(newRequest("POST", "/api/issues/"+fx.IssueID+"/comments", body), "id", fx.IssueID)
		if asAgent {
			r.Header.Set("X-Agent-ID", fx.LeaderID)
			r.Header.Set("X-Task-ID", fx.TaskID)
		}
		testHandler.CreateComment(w, r)
		if w.Code != http.StatusCreated {
			t.Fatalf("CreateComment %v: expected 201, got %d: %s", body, w.Code, w.Body.String())
		}
		var created CommentResponse
		if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
			t.Fatalf("decode comment: %v", err)
		}
		return created.ID
	}
	for name, id := range map[string]string{
		"agent without parent": post(map[string]any{"content": "top-level reply"}, true),
		"agent with parent":    post(map[string]any{"content": "reply with a stale parent", "parent_id": fx.TriggerCommentID}, true),
		"person with parent":   post(map[string]any{"content": "person replying", "parent_id": fx.TriggerCommentID}, false),
	} {
		var parent *string
		if err := testPool.QueryRow(ctx, `SELECT parent_id::text FROM comment WHERE id = $1`, id).Scan(&parent); err != nil {
			t.Fatalf("%s: load comment: %v", name, err)
		}
		if parent != nil {
			t.Fatalf("%s: stored under parent %s, want a top-level message", name, *parent)
		}
	}
}

// TestCreateComment_TriggeredTaskRejectsForeignParent covers the resumed-session
// drift in GH #6264: the task passes a --parent that is a real comment on its
// own issue but not one this run was given to answer. The refusal must name
// both the parent it rejected and the parent to use — and must NOT say a
// top-level comment was attempted, since that wording sent agents looking for a
// new-thread opt-in instead of correcting the --parent they already passed.
func TestCreateComment_TriggeredTaskRejectsForeignParent(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	fx := newRunningSquadLeaderTaskFixture(t)

	// Must be a real comment on the same issue: a nonexistent id, or one from
	// another issue, is refused earlier with a 400 and never reaches this guard.
	var foreignParentID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO comment (issue_id, workspace_id, author_type, author_id, content, type)
		VALUES ($1, $2, 'member', $3, 'an earlier thread this task never owned', 'comment')
		RETURNING id
	`, fx.IssueID, testWorkspaceID, testUserID).Scan(&foreignParentID); err != nil {
		t.Fatalf("create foreign parent comment: %v", err)
	}

	w := httptest.NewRecorder()
	r := newRequest("POST", "/api/issues/"+fx.IssueID+"/comments", map[string]any{
		"content":   "posting under a parent carried over from a previous turn",
		"parent_id": foreignParentID,
	})
	r = withURLParam(r, "id", fx.IssueID)
	r.Header.Set("X-Agent-ID", fx.LeaderID)
	r.Header.Set("X-Task-ID", fx.TaskID)

	testHandler.CreateComment(w, r)
	if w.Code != http.StatusConflict {
		t.Fatalf("CreateComment foreign parent: expected 409, got %d: %s", w.Code, w.Body.String())
	}
	if got := countAgentCommentsForIssue(t, fx.IssueID, fx.LeaderID); got != 0 {
		t.Fatalf("expected rejected comment not to be stored, got %d", got)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	msg, _ := body["error"].(string)
	for _, want := range []string{
		foreignParentID,        // the parent that was refused
		fx.TriggerCommentID,    // the parent to use instead
		"parent_id (--parent)", // actionable fix
	} {
		if !strings.Contains(msg, want) {
			t.Fatalf("409 message should contain %q, got %q", want, msg)
		}
	}
	if strings.Contains(msg, "top-level") {
		t.Fatalf("409 message must not claim a top-level comment was attempted, got %q", msg)
	}
}
