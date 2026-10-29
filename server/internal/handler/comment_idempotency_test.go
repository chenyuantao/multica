package handler

import (
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestCreateCommentClientIDReturnsOriginalMessageOnRetry(t *testing.T) {
	issueID := dbfx.Issue(t, "idempotent message fixture")
	clientID := "f40d3b26-132d-4eed-a462-37fa1a54f1f2"
	post := func(content string, status int) CommentResponse {
		t.Helper()
		var out CommentResponse
		testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, http.MethodPost, "/api/issues/"+issueID+"/comments", map[string]any{
			"content": content, "client_id": clientID,
		}), "id", issueID)).Want(status).JSON(&out)
		return out
	}
	first := post("the first body", http.StatusCreated)
	second := post("a retry body that must not replace the original", http.StatusOK)
	if first.ID != second.ID || first.Content != "the first body" || second.Content != first.Content {
		t.Fatalf("retry returned a different message: first=%+v second=%+v", first, second)
	}
	comments, err := testHandler.Queries.ListCommentsForIssue(t.Context(), db.ListCommentsForIssueParams{
		IssueID: parseUUID(issueID), WorkspaceID: parseUUID(testWorkspaceID), Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 1 {
		t.Fatalf("persisted comments=%d, want 1", len(comments))
	}
}
