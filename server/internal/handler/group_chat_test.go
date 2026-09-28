package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func groupChatRequestAs(t *testing.T, userID, method, path string, body any) *http.Request {
	t.Helper()
	req := newRequest(method, path, body)
	req.Header.Set("X-User-ID", userID)
	return chatPendingCtxAs(t, req, userID)
}

func groupChatWorkspaceMember(t *testing.T, name, email string) string {
	t.Helper()
	userID := dbfx.User(t, name, email)
	dbfx.Member(t, testWorkspaceID, userID, "member")
	return userID
}

func TestGroupChatMembershipLifecycle(t *testing.T) {
	ctx := context.Background()
	memberB := groupChatWorkspaceMember(t, "Group Chat B", "group-chat-b@multica.test")
	outsider := groupChatWorkspaceMember(t, "Group Chat Outsider", "group-chat-outsider@multica.test")
	agentIn := createHandlerTestAgent(t, "group-chat-agent-in", nil)
	agentOut := createHandlerTestAgent(t, "group-chat-agent-out", nil)

	var chat GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title": "Launch room",
		"members": []map[string]string{
			{"member_type": "member", "member_id": memberB},
			{"member_type": "agent", "member_id": agentIn},
		},
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})
	if len(chat.Members) != 3 {
		t.Fatalf("members = %d, want creator + person + agent", len(chat.Members))
	}
	if chat.LastCommentAt != nil {
		t.Fatalf("new chat last_comment_at = %v, want nil", *chat.LastCommentAt)
	}

	getIssueAs := func(userID string) *testutil.Response {
		return testutil.Call(t, testHandler.GetIssue, withURLParam(groupChatRequestAs(t, userID, "GET", "/api/issues/"+chat.ID, nil), "id", chat.ID))
	}
	listChatsAs := func(userID string) []GroupChatResponse {
		var out struct {
			Chats []GroupChatResponse `json:"chats"`
		}
		testutil.Call(t, testHandler.ListGroupChats, groupChatRequestAs(t, userID, "GET", "/api/group-chats", nil)).Want(http.StatusOK).JSON(&out)
		return out.Chats
	}
	containsChat := func(chats []GroupChatResponse) *GroupChatResponse {
		for i := range chats {
			if chats[i].ID == chat.ID {
				return &chats[i]
			}
		}
		return nil
	}

	getIssueAs(memberB).Want(http.StatusOK)
	getIssueAs(outsider).Want(http.StatusNotFound)
	if containsChat(listChatsAs(outsider)) != nil {
		t.Fatal("outsider sees the chat in their list")
	}
	if containsChat(listChatsAs(memberB)) == nil {
		t.Fatal("member does not see the chat in their list")
	}

	// Only the creator manages members.
	testutil.Call(t, testHandler.AddGroupChatMember, withURLParam(groupChatRequestAs(t, memberB, "POST", "/api/group-chats/"+chat.ID+"/members", map[string]string{
		"member_type": "member", "member_id": outsider,
	}), "id", chat.ID)).Want(http.StatusForbidden)

	// Mentioning an agent outside the chat is refused before anything is written.
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chat.ID+"/comments", map[string]string{
		"content": "[@Out](mention://agent/" + agentOut + ") please look",
	}), "id", chat.ID)).Want(http.StatusBadRequest)

	var created CommentResponse
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, memberB, "POST", "/api/issues/"+chat.ID+"/comments", map[string]string{
		"content": "Onboarding looks good",
	}), "id", chat.ID)).Want(http.StatusCreated).JSON(&created)

	listed := containsChat(listChatsAs(testUserID))
	if listed == nil || listed.LastCommentAt == nil || listed.LastMessage == nil {
		t.Fatalf("chat after message = %+v, want last_comment_at and last_message", listed)
	}
	if listed.LastMessage.ID != created.ID {
		t.Fatalf("last_message = %s, want %s", listed.LastMessage.ID, created.ID)
	}
	var lastCommentAt, commentCreatedAt string
	dbfx.QueryRow(t, `SELECT i.last_comment_at::text, c.created_at::text FROM issue i JOIN comment c ON c.issue_id = i.id WHERE i.id = $1 AND c.id = $2`, chat.ID, created.ID).Scan(&lastCommentAt, &commentCreatedAt)
	if lastCommentAt != commentCreatedAt {
		t.Fatalf("last_comment_at = %s, want the message time %s", lastCommentAt, commentCreatedAt)
	}

	testutil.Call(t, testHandler.RemoveGroupChatMember, testutil.WithURLParams(groupChatRequestAs(t, testUserID, "DELETE", "/api/group-chats/"+chat.ID+"/members/member/"+memberB, nil),
		"id", chat.ID, "memberType", "member", "memberId", memberB)).Want(http.StatusNoContent)
	getIssueAs(memberB).Want(http.StatusNotFound)

	testutil.Call(t, testHandler.RemoveGroupChatMember, testutil.WithURLParams(groupChatRequestAs(t, testUserID, "DELETE", "/api/group-chats/"+chat.ID+"/members/member/"+testUserID, nil),
		"id", chat.ID, "memberType", "member", "memberId", testUserID)).Want(http.StatusBadRequest)
}
