package handler

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/typesafe"
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

	// Any chat member can rename the chat; outsiders cannot see it.
	renameAs := func(userID, title string) *testutil.Response {
		return testutil.Call(t, testHandler.UpdateGroupChat, withURLParam(groupChatRequestAs(t, userID, "PATCH", "/api/group-chats/"+chat.ID, map[string]string{
			"title": title,
		}), "id", chat.ID))
	}
	var renamed GroupChatResponse
	renameAs(memberB, "  Launch war room  ").Want(http.StatusOK).JSON(&renamed)
	if renamed.Title != "Launch war room" || len(renamed.Members) != 3 {
		t.Fatalf("renamed chat = %q with %d members, want trimmed title and unchanged members", renamed.Title, len(renamed.Members))
	}
	renameAs(memberB, "   ").Want(http.StatusBadRequest)
	renameAs(outsider, "Hijacked").Want(http.StatusNotFound)
	if listed := containsChat(listChatsAs(testUserID)); listed == nil || listed.Title != "Launch war room" {
		t.Fatalf("listed chat after rename = %+v, want new title", listed)
	}

	// The announcement is the issue description; any member may edit it and a
	// rename leaves it untouched.
	var announced GroupChatResponse
	testutil.Call(t, testHandler.UpdateGroupChat, withURLParam(groupChatRequestAs(t, memberB, "PATCH", "/api/group-chats/"+chat.ID, map[string]string{
		"description": "Ship on **Friday**",
	}), "id", chat.ID)).Want(http.StatusOK).JSON(&announced)
	if announced.Description != "Ship on **Friday**" || announced.Title != "Launch war room" {
		t.Fatalf("announced chat = %+v, want new description and unchanged title", announced)
	}
	renameAs(memberB, "Launch room").Want(http.StatusOK)
	if listed := containsChat(listChatsAs(testUserID)); listed == nil || listed.Description != "Ship on **Friday**" {
		t.Fatalf("listed chat after rename = %+v, want announcement kept", listed)
	}
	testutil.Call(t, testHandler.UpdateGroupChat, withURLParam(groupChatRequestAs(t, memberB, "PATCH", "/api/group-chats/"+chat.ID, map[string]string{}), "id", chat.ID)).Want(http.StatusBadRequest)

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

// A direct chat is reused from either side and keeps its two members; a
// two-person chat created as a group is not a direct chat.
func TestOpenDirectGroupChat(t *testing.T) {
	ctx := context.Background()
	peer := groupChatWorkspaceMember(t, "Direct Chat Peer", "direct-chat-peer@multica.test")
	third := groupChatWorkspaceMember(t, "Direct Chat Third", "direct-chat-third@multica.test")
	agent := createHandlerTestAgent(t, "direct-chat-agent", nil)

	var chatIDs []string
	t.Cleanup(func() {
		for _, id := range chatIDs {
			for _, sql := range []string{
				`DELETE FROM issue_member WHERE issue_id = $1`,
				`DELETE FROM issue_subscriber WHERE issue_id = $1`,
				`DELETE FROM issue WHERE id = $1`,
			} {
				testPool.Exec(ctx, sql, id)
			}
		}
	})
	open := func(userID, peerType, peerID string, want int) GroupChatResponse {
		var out GroupChatResponse
		res := testutil.Call(t, testHandler.OpenDirectGroupChat, groupChatRequestAs(t, userID, "POST", "/api/group-chats/direct", map[string]string{
			"member_type": peerType, "member_id": peerID,
		})).Want(want)
		if want == http.StatusOK || want == http.StatusCreated {
			res.JSON(&out)
			chatIDs = append(chatIDs, out.ID)
		}
		return out
	}
	createGroup := func(members ...string) GroupChatResponse {
		refs := []map[string]string{}
		for _, id := range members {
			refs = append(refs, map[string]string{"member_type": "member", "member_id": id})
		}
		var out GroupChatResponse
		testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
			"title": "Group", "members": refs,
		})).Want(http.StatusCreated).JSON(&out)
		chatIDs = append(chatIDs, out.ID)
		return out
	}
	listChats := func(userID string) []GroupChatResponse {
		var out struct {
			Chats []GroupChatResponse `json:"chats"`
		}
		testutil.Call(t, testHandler.ListGroupChats, groupChatRequestAs(t, userID, "GET", "/api/group-chats", nil)).Want(http.StatusOK).JSON(&out)
		return out.Chats
	}

	trio := createGroup(peer, third)
	pair := createGroup(peer)
	if trio.IsDirect || pair.IsDirect {
		t.Fatal("chats created as groups are direct chats")
	}

	created := open(testUserID, "member", peer, http.StatusCreated)
	if created.ID == pair.ID || !created.IsDirect || len(created.Members) != 2 || created.Title != "Direct Chat Peer" {
		t.Fatalf("direct chat = %+v, want a new direct chat named after the peer", created)
	}
	if again := open(testUserID, "member", peer, http.StatusOK); again.ID != created.ID {
		t.Fatalf("reopened direct chat = %s, want %s", again.ID, created.ID)
	}
	if fromPeer := open(peer, "member", testUserID, http.StatusOK); fromPeer.ID != created.ID {
		t.Fatalf("peer opened %s, want the shared chat %s", fromPeer.ID, created.ID)
	}

	// Membership is fixed, even for the creator.
	testutil.Call(t, testHandler.AddGroupChatMember, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/"+created.ID+"/members", map[string]string{
		"member_type": "member", "member_id": third,
	}), "id", created.ID)).Want(http.StatusBadRequest)
	testutil.Call(t, testHandler.RemoveGroupChatMember, testutil.WithURLParams(groupChatRequestAs(t, testUserID, "DELETE", "/api/group-chats/"+created.ID+"/members/member/"+peer, nil),
		"id", created.ID, "memberType", "member", "memberId", peer)).Want(http.StatusBadRequest)

	withAgent := open(testUserID, "agent", agent, http.StatusCreated)
	if withAgent.ID == created.ID || !withAgent.IsDirect || withAgent.Title != "direct-chat-agent" {
		t.Fatalf("agent direct chat = %+v, want its own direct chat named after the agent", withAgent)
	}
	if again := open(testUserID, "agent", agent, http.StatusOK); again.ID != withAgent.ID {
		t.Fatalf("reopened agent chat = %s, want %s", again.ID, withAgent.ID)
	}

	// A second direct chat with the same peer, as two concurrent opens could
	// leave behind, stays out of both sides' lists.
	duplicate := createGroup(peer)
	dbfx.Exec(t, `UPDATE issue SET is_direct_chat = true WHERE id = $1`, duplicate.ID)
	for _, userID := range []string{testUserID, peer} {
		var direct []string
		for _, c := range listChats(userID) {
			if c.ID == duplicate.ID {
				t.Fatalf("user %s sees the duplicate direct chat", userID)
			}
			if c.IsDirect {
				direct = append(direct, c.ID)
			}
		}
		if !slices.Contains(direct, created.ID) {
			t.Fatalf("user %s direct chats = %v, want %s", userID, direct, created.ID)
		}
	}
	if again := open(testUserID, "member", peer, http.StatusOK); again.ID != created.ID {
		t.Fatalf("reopened direct chat after duplicate = %s, want the oldest %s", again.ID, created.ID)
	}

	open(testUserID, "member", testUserID, http.StatusBadRequest)
}

// A chat's unread count is its unread messages, and opening the chat reads all
// of them rather than only the newest notification.
func TestGroupChatUnreadCountAndMarkRead(t *testing.T) {
	ctx := context.Background()
	memberB := groupChatWorkspaceMember(t, "Group Chat Unread B", "group-chat-unread-b@multica.test")

	var chat GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   "Unread room",
		"members": []map[string]string{{"member_type": "member", "member_id": memberB}},
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM inbox_item WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})

	notify := func(notifType, commentID string, read bool, age string) {
		dbfx.Exec(t, `
			INSERT INTO inbox_item (workspace_id, recipient_type, recipient_id, type, title, issue_id, read, details, created_at)
			VALUES ($1, 'member', $2, $3, 'Unread room', $4, $5, jsonb_build_object('comment_id', $6::text), now() - $7::interval)
		`, testWorkspaceID, testUserID, notifType, chat.ID, read, commentID, age)
	}
	notify("new_comment", "00000000-0000-0000-0000-00000000c001", true, "4 minutes")
	notify("new_comment", "00000000-0000-0000-0000-00000000c002", false, "3 minutes")
	notify("new_comment", "00000000-0000-0000-0000-00000000c003", false, "2 minutes")
	// A mention creates a second row for the same message; it counts once.
	notify("mentioned", "00000000-0000-0000-0000-00000000c003", false, "2 minutes")
	notify("new_comment", "00000000-0000-0000-0000-00000000c004", false, "1 minute")

	unreadInList := func() int64 {
		var out struct {
			Chats []GroupChatResponse `json:"chats"`
		}
		testutil.Call(t, testHandler.ListGroupChats, groupChatRequestAs(t, testUserID, "GET", "/api/group-chats", nil)).Want(http.StatusOK).JSON(&out)
		for _, c := range out.Chats {
			if c.ID == chat.ID {
				return c.UnreadCount
			}
		}
		t.Fatal("chat missing from list")
		return 0
	}
	summary := func() InboxWorkspaceUnreadResponse {
		var rows []InboxWorkspaceUnreadResponse
		testutil.Call(t, testHandler.UnreadInboxSummary, groupChatRequestAs(t, testUserID, "GET", "/api/inbox/unread-summary", nil)).Want(http.StatusOK).JSON(&rows)
		for _, row := range rows {
			if row.WorkspaceID == testWorkspaceID {
				return row
			}
		}
		return InboxWorkspaceUnreadResponse{WorkspaceID: testWorkspaceID}
	}

	if got := unreadInList(); got != 3 {
		t.Fatalf("unread_count = %d, want 3 distinct unread messages", got)
	}
	before := summary()

	markRead := func(userID string) *testutil.Response {
		return testutil.Call(t, testHandler.MarkGroupChatRead, withURLParam(groupChatRequestAs(t, userID, "POST", "/api/group-chats/"+chat.ID+"/read", nil), "id", chat.ID))
	}
	outsider := groupChatWorkspaceMember(t, "Group Chat Unread Outsider", "group-chat-unread-outsider@multica.test")
	markRead(outsider).Want(http.StatusNotFound)

	var marked struct {
		Count int64 `json:"count"`
	}
	markRead(testUserID).Want(http.StatusOK).JSON(&marked)
	if marked.Count != 4 {
		t.Fatalf("marked %d rows, want every unread row of the chat", marked.Count)
	}
	if got := unreadInList(); got != 0 {
		t.Fatalf("unread_count after mark read = %d, want 0", got)
	}
	after := summary()
	if before.Count-after.Count != 1 {
		t.Fatalf("summary count dropped by %d, want the chat to count as one issue", before.Count-after.Count)
	}
	if before.BadgeCount-after.BadgeCount != 3 {
		t.Fatalf("badge_count dropped by %d, want the chat's 3 unread messages", before.BadgeCount-after.BadgeCount)
	}
}

func TestSearchGroupChatsCountsMatchingMessagesPerChat(t *testing.T) {
	ctx := context.Background()
	memberB := groupChatWorkspaceMember(t, "Group Chat Search B", "group-chat-search-b@multica.test")
	outsider := groupChatWorkspaceMember(t, "Group Chat Search Outsider", "group-chat-search-outsider@multica.test")

	var chat GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   "Search room",
		"members": []map[string]string{{"member_type": "member", "member_id": memberB}},
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})
	post := func(content, commentType, age string) {
		dbfx.Exec(t, `
			INSERT INTO comment (issue_id, workspace_id, author_type, author_id, content, type, created_at)
			VALUES ($1, $2, 'member', $3, $4, $5, now() - $6::interval)
		`, chat.ID, testWorkspaceID, memberB, content, commentType, age)
	}
	post("first Zephyrine note", "comment", "3 minutes")
	post("the newest zephyrine_ update", "comment", "1 minute")
	post("unrelated", "comment", "2 minutes")
	post("zephyrine moved to done", "status_change", "30 seconds")

	search := func(userID, q string) []GroupChatSearchHit {
		var out struct {
			Hits []GroupChatSearchHit `json:"hits"`
		}
		testutil.Call(t, testHandler.SearchGroupChats, groupChatRequestAs(t, userID, "GET", "/api/group-chats/search?q="+q, nil)).Want(http.StatusOK).JSON(&out)
		return out.Hits
	}

	hits := search(testUserID, "ZEPHYRINE")
	if len(hits) != 1 || hits[0].ChatID != chat.ID || hits[0].HitCount != 2 || hits[0].Snippet != "the newest zephyrine_ update" {
		t.Fatalf("hits = %+v, want one hit for the chat counting its two messages", hits)
	}
	// LIKE wildcards in the keyword match literally.
	if hits := search(testUserID, "zephyrine_"); len(hits) != 1 || hits[0].HitCount != 1 {
		t.Fatalf("literal underscore hits = %+v", hits)
	}
	if hits := search(outsider, "zephyrine"); len(hits) != 0 {
		t.Fatalf("outsider hits = %+v, want none", hits)
	}
	testutil.Call(t, testHandler.SearchGroupChats, groupChatRequestAs(t, testUserID, "GET", "/api/group-chats/search?q=%20", nil)).Want(http.StatusBadRequest)
}

func TestGroupChatPinIsPerPersonAndSortsFirst(t *testing.T) {
	ctx := context.Background()
	memberB := groupChatWorkspaceMember(t, "Group Chat Pin B", "group-chat-pin-b@multica.test")
	outsider := groupChatWorkspaceMember(t, "Group Chat Pin Outsider", "group-chat-pin-outsider@multica.test")

	create := func(title string) GroupChatResponse {
		var chat GroupChatResponse
		testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
			"title":   title,
			"members": []map[string]string{{"member_type": "member", "member_id": memberB}},
		})).Want(http.StatusCreated).JSON(&chat)
		t.Cleanup(func() {
			for _, sql := range []string{
				`DELETE FROM issue_member WHERE issue_id = $1`,
				`DELETE FROM issue_subscriber WHERE issue_id = $1`,
				`DELETE FROM issue WHERE id = $1`,
			} {
				testPool.Exec(ctx, sql, chat.ID)
			}
		})
		return chat
	}
	quiet := create("Quiet room")
	busy := create("Busy room")
	dbfx.Exec(t, `UPDATE issue SET last_comment_at = now() - interval '1 day' WHERE id = $1`, quiet.ID)
	dbfx.Exec(t, `UPDATE issue SET last_comment_at = now() WHERE id = $1`, busy.ID)

	listAs := func(userID string) []GroupChatResponse {
		var out struct {
			Chats []GroupChatResponse `json:"chats"`
		}
		testutil.Call(t, testHandler.ListGroupChats, groupChatRequestAs(t, userID, "GET", "/api/group-chats", nil)).Want(http.StatusOK).JSON(&out)
		return out.Chats
	}
	indexOf := func(chats []GroupChatResponse, id string) int {
		return slices.IndexFunc(chats, func(c GroupChatResponse) bool { return c.ID == id })
	}
	pin := func(userID string, body any) *testutil.Response {
		return testutil.Call(t, testHandler.SetGroupChatPinned, withURLParam(groupChatRequestAs(t, userID, "PATCH", "/api/group-chats/"+quiet.ID+"/pin", body), "id", quiet.ID))
	}

	pin(outsider, map[string]bool{"pinned": true}).Want(http.StatusNotFound)
	pin(testUserID, map[string]any{}).Want(http.StatusBadRequest)

	var pinned GroupChatResponse
	pin(testUserID, map[string]bool{"pinned": true}).Want(http.StatusOK).JSON(&pinned)
	if !pinned.Pinned {
		t.Fatal("pin response pinned = false, want true")
	}

	mine := listAs(testUserID)
	if len(mine) == 0 || mine[0].ID != quiet.ID || !mine[0].Pinned {
		t.Fatalf("pinned chat is not first in the pinner's list: %+v", mine)
	}
	theirs := listAs(memberB)
	qi, bi := indexOf(theirs, quiet.ID), indexOf(theirs, busy.ID)
	if qi < 0 || bi < 0 || theirs[qi].Pinned || qi < bi {
		t.Fatalf("another member's list changed: quiet=%d busy=%d", qi, bi)
	}

	pin(testUserID, map[string]bool{"pinned": false}).Want(http.StatusOK).JSON(&pinned)
	if pinned.Pinned {
		t.Fatal("unpin response pinned = true, want false")
	}
	mine = listAs(testUserID)
	if qi, bi := indexOf(mine, quiet.ID), indexOf(mine, busy.ID); mine[qi].Pinned || qi < bi {
		t.Fatalf("unpinned chat did not return to activity order: quiet=%d busy=%d", qi, bi)
	}
}

func TestGroupChatQuotedMessageReachesAgentInFull(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "group-chat-quote-agent", nil)

	newChat := func(title string) GroupChatResponse {
		var chat GroupChatResponse
		testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
			"title":   title,
			"members": []map[string]string{{"member_type": "agent", "member_id": agentID}},
		})).Want(http.StatusCreated).JSON(&chat)
		t.Cleanup(func() {
			for _, sql := range []string{
				`DELETE FROM agent_task_queue WHERE issue_id = $1`,
				`DELETE FROM issue_member WHERE issue_id = $1`,
				`DELETE FROM issue_subscriber WHERE issue_id = $1`,
				`DELETE FROM comment_focus_note WHERE issue_id = $1`,
				`DELETE FROM comment WHERE issue_id = $1`,
				`DELETE FROM issue WHERE id = $1`,
			} {
				testPool.Exec(ctx, sql, chat.ID)
			}
		})
		return chat
	}
	post := func(chatID string, body map[string]any) *testutil.Response {
		return testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chatID+"/comments", body), "id", chatID))
	}

	chat := newChat("Quote room")
	other := newChat("Other room")
	var quoted, foreign, reply CommentResponse
	post(chat.ID, map[string]any{"content": "Ship the v2 importer on Friday"}).Want(http.StatusCreated).JSON(&quoted)
	post(other.ID, map[string]any{"content": "elsewhere"}).Want(http.StatusCreated).JSON(&foreign)

	post(chat.ID, map[string]any{"content": "why?", "ref_message_id": foreign.ID}).Want(http.StatusBadRequest)
	post(chat.ID, map[string]any{"content": "why?", "ref_message_id": "not-a-uuid"}).Want(http.StatusBadRequest)
	post(chat.ID, map[string]any{"content": "why Friday?", "ref_message_id": quoted.ID}).Want(http.StatusCreated).JSON(&reply)
	if reply.RefMessageID == nil || *reply.RefMessageID != quoted.ID {
		t.Fatalf("ref_message_id = %v, want %s", reply.RefMessageID, quoted.ID)
	}

	issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(chat.ID))
	if err != nil {
		t.Fatal(err)
	}
	roster, _ := testHandler.groupChatRosterIfChat(ctx, issue)
	var got *groupchat.Turn
	for _, turn := range testHandler.groupChatTurns(ctx, issue, roster) {
		if turn.ID == reply.ID {
			got = turn.Ref
		}
	}
	if got == nil || got.ID != quoted.ID || got.Text != "Ship the v2 importer on Friday" || got.Role != "member" {
		t.Fatalf("quoted turn = %+v, want the full quoted message", got)
	}

	var focused CommentResponse
	post(chat.ID, map[string]any{
		"content":        "about this note",
		"ref_message_id": quoted.ID,
		"focus_note":     map[string]string{"name": "本周周报", "path": "notes/weekly.md"},
	}).Want(http.StatusCreated).JSON(&focused)
	var focusedTurn groupchat.Turn
	foundFocus := false
	for _, turn := range testHandler.groupChatTurns(ctx, issue, roster) {
		if turn.ID == focused.ID {
			focusedTurn = turn
			foundFocus = true
		}
	}
	if !foundFocus || focusedTurn.Ref == nil || focusedTurn.Ref.ID != quoted.ID {
		t.Fatalf("focused turn = %+v, want the quote kept", focusedTurn)
	}
	if focusedTurn.Focus == nil || focusedTurn.Focus.Name != "本周周报" || focusedTurn.Focus.Path != "notes/weekly.md" {
		t.Fatalf("focus = %+v, want the open note", focusedTurn.Focus)
	}
}

func TestGroupChatHistoryCardIsContextNotATrigger(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "group-chat-history-agent", nil)

	var chat GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   "History room",
		"members": []map[string]string{{"member_type": "agent", "member_id": agentID}},
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})
	tasks := func() int {
		return dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, chat.ID, agentID)
	}
	post := func(body map[string]any) CommentResponse {
		t.Helper()
		var out CommentResponse
		testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chat.ID+"/comments", body), "id", chat.ID)).Want(http.StatusCreated).JSON(&out)
		return out
	}

	card := "```multica-chat-history\n" +
		`{"messages":[{"author_name":"Ada","content":"ship <v2> on Friday","created_at":"2026-09-30T13:00:00Z"},{"author_name":"Bo","content":"ask [@Ada](mention:` + "\u200b" + `//agent/a1)","created_at":"2026-09-30T13:01:00Z"}]}` +
		"\n```"
	forwarded := post(map[string]any{"content": card})
	if n := tasks(); n != 0 {
		t.Fatalf("tasks after chat history card = %d, want 0", n)
	}

	question := post(map[string]any{"content": "what did Ada decide?", "ref_message_id": forwarded.ID})
	if question.RefMessageID == nil || *question.RefMessageID != forwarded.ID {
		t.Fatalf("ref_message_id = %v, want %s", question.RefMessageID, forwarded.ID)
	}
	if n := tasks(); n != 1 {
		t.Fatalf("tasks after the question = %d, want 1", n)
	}

	issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(chat.ID))
	if err != nil {
		t.Fatal(err)
	}
	var resp AgentTaskResponse
	testHandler.attachGroupChatTranscript(ctx, &resp, issue, db.AgentTaskQueue{
		AgentID:          parseUUID(agentID),
		TriggerCommentID: parseUUID(question.ID),
	})
	xml := resp.GroupChatTranscript
	record := "Ada (2026-09-30T13:00:00Z): ship &lt;v2&gt; on Friday\nBo (2026-09-30T13:01:00Z): ask [@Ada](mention://agent/a1)"
	if strings.Count(xml, record) != 2 {
		t.Fatalf("record should appear in the message and in the quote:\n%s", xml)
	}
	cardOpen := groupChatMsgOpen(xml, forwarded.ID)
	if cardOpen == "" {
		t.Fatalf("history card missing from the transcript:\n%s", xml)
	}
	if strings.Contains(cardOpen, `trigger="true"`) {
		t.Fatalf("history card became the trigger:\n%s", cardOpen)
	}
	if !strings.Contains(xml, `id="`+question.ID+`"`) || !strings.Contains(xml, `trigger="true"`) || !strings.Contains(xml, "what did Ada decide?") {
		t.Fatalf("question was not the trigger:\n%s", xml)
	}
	if strings.Contains(xml, "mention:\u200b//") {
		t.Fatalf("shielded mention leaked into the transcript:\n%s", xml)
	}
}

// groupChatMsgOpen is the opening tag of the msg whose id is the message
// itself. A ref that quotes the same id is ignored.
func groupChatMsgOpen(xml, id string) string {
	token := ` id="` + id + `"`
	for at := 0; at < len(xml); {
		i := strings.Index(xml[at:], token)
		if i < 0 {
			return ""
		}
		i += at
		start := strings.LastIndex(xml[:i], "<")
		if start >= 0 && strings.HasPrefix(xml[start:], "<msg ") {
			end := strings.Index(xml[start:], ">")
			if end > 0 {
				return xml[start : start+end]
			}
		}
		at = i + len(token)
	}
	return ""
}

func TestGroupChatAttachmentOnlyMessageStartsNoAgent(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "group-chat-attachment-agent", nil)

	var chat GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   "Attachment room",
		"members": []map[string]string{{"member_type": "agent", "member_id": agentID}},
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM attachment WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})
	tasks := func() int {
		return dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, chat.ID, agentID)
	}

	attachmentID := unlinkedIssueAttachment(t, chat.ID)
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chat.ID+"/comments", map[string]any{
		"content":        "![shot.png](https://example.test/shot.png)",
		"attachment_ids": []string{attachmentID},
	}), "id", chat.ID)).Want(http.StatusCreated)
	if n := tasks(); n != 0 {
		t.Fatalf("tasks after attachment-only message = %d, want 0", n)
	}

	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chat.ID+"/comments", map[string]string{
		"content": "what is in this screenshot?",
	}), "id", chat.ID)).Want(http.StatusCreated)
	if n := tasks(); n != 1 {
		t.Fatalf("tasks after text message = %d, want 1", n)
	}
}

func TestDirectChatTranscriptOmitsTitleAndNotice(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "direct-transcript-agent", nil)

	var direct GroupChatResponse
	testutil.Call(t, testHandler.OpenDirectGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/direct", map[string]any{
		"member_type": "agent", "member_id": agentID,
	})).Want(http.StatusCreated).JSON(&direct)
	var room GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   "Launch <room>",
		"members": []map[string]string{{"member_type": "agent", "member_id": agentID}},
	})).Want(http.StatusCreated).JSON(&room)

	for _, id := range []string{direct.ID, room.ID} {
		t.Cleanup(func() {
			for _, sql := range []string{
				`DELETE FROM agent_task_queue WHERE issue_id = $1`,
				`DELETE FROM issue_member WHERE issue_id = $1`,
				`DELETE FROM issue_subscriber WHERE issue_id = $1`,
				`DELETE FROM comment WHERE issue_id = $1`,
				`DELETE FROM issue WHERE id = $1`,
			} {
				testPool.Exec(ctx, sql, id)
			}
		})
	}

	for _, id := range []string{direct.ID, room.ID} {
		testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+id+"/comments", map[string]string{
			"content": "ping",
		}), "id", id)).Want(http.StatusCreated)
		testutil.Call(t, testHandler.UpdateGroupChat, withURLParam(groupChatRequestAs(t, testUserID, "PATCH", "/api/group-chats/"+id, map[string]string{
			"description": "Ship on Friday",
		}), "id", id)).Want(http.StatusOK)
	}

	render := func(id string) string {
		t.Helper()
		issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(id))
		if err != nil {
			t.Fatal(err)
		}
		var resp AgentTaskResponse
		testHandler.attachGroupChatTranscript(ctx, &resp, issue, db.AgentTaskQueue{})
		return resp.GroupChatTranscript
	}

	directXML := render(direct.ID)
	if strings.Contains(directXML, "<title>") || strings.Contains(directXML, "<notice>") {
		t.Fatalf("direct chat transcript includes a heading:\n%s", directXML)
	}
	if !strings.Contains(directXML, ">ping</msg>") {
		t.Fatalf("direct chat transcript missing the message:\n%s", directXML)
	}

	roomXML := render(room.ID)
	if !strings.Contains(roomXML, "<title>Launch &lt;room&gt;</title>") || !strings.Contains(roomXML, "<notice>\nShip on Friday\n</notice>") {
		t.Fatalf("group transcript missing title or notice:\n%s", roomXML)
	}
}

type groupChatFilterEvaluator struct {
	choice    string
	state     groupchat.FilterState
	questions map[string]any
}

func (e *groupChatFilterEvaluator) Enabled() bool { return true }
func (e *groupChatFilterEvaluator) Evaluate(_ context.Context, state any, questions map[string]any) (map[string]typesafe.Answer, error) {
	e.state, _ = state.(groupchat.FilterState)
	e.questions = questions
	out := make(map[string]typesafe.Answer, len(questions))
	for key := range questions {
		out[key] = typesafe.Answer{Type: "choice", Choice: e.choice, Confidence: 1}
	}
	return out, nil
}

func TestDirectChatTranscriptHidesUnrelatedMessages(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "direct-filter-agent", nil)
	var chat GroupChatResponse
	testutil.Call(t, testHandler.OpenDirectGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/direct", map[string]any{
		"member_type": "agent", "member_id": agentID,
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})
	insert := func(content, age string) string {
		t.Helper()
		var id string
		dbfx.QueryRow(t, `
			INSERT INTO comment (issue_id, workspace_id, author_type, author_id, content, type, created_at)
			VALUES ($1, $2, 'member', $3, $4, 'comment', now() - $5::interval)
			RETURNING id::text
		`, chat.ID, testWorkspaceID, testUserID, content, age).Scan(&id)
		return id
	}
	insert("lunch plans from last week", "2 minutes")
	checkID := insert("what failed in the deploy?", "1 second")

	ev := &groupChatFilterEvaluator{choice: "屏蔽"}
	prev := testHandler.GroupChatDecider
	testHandler.GroupChatDecider = ev
	t.Cleanup(func() { testHandler.GroupChatDecider = prev })

	issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(chat.ID))
	if err != nil {
		t.Fatal(err)
	}
	var resp AgentTaskResponse
	testHandler.attachGroupChatTranscript(ctx, &resp, issue, db.AgentTaskQueue{
		AgentID:          parseUUID(agentID),
		TriggerCommentID: parseUUID(checkID),
	})
	xml := resp.GroupChatTranscript
	if strings.Contains(xml, "lunch plans from last week") || !strings.Contains(xml, ">"+groupchat.HiddenMessageText+"</msg>") {
		t.Fatalf("direct chat left the unrelated message visible:\n%s", xml)
	}
	if !strings.Contains(xml, "what failed in the deploy?") || len(ev.questions) != 1 {
		t.Fatalf("the question was hidden or not judged alone:\n%s\nquestions=%d", xml, len(ev.questions))
	}
}

func TestGroupChatTranscriptHidesMessagesTheAgentDoesNotNeed(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "filter-transcript-agent", nil)
	var room GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   "Filter room",
		"members": []map[string]string{{"member_type": "agent", "member_id": agentID}},
	})).Want(http.StatusCreated).JSON(&room)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM attachment WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, room.ID)
		}
	})

	insert := func(authorType, authorID, content, age string) string {
		t.Helper()
		var id string
		dbfx.QueryRow(t, `
			INSERT INTO comment (issue_id, workspace_id, author_type, author_id, content, type, created_at)
			VALUES ($1, $2, $3, $4, $5, 'comment', now() - $6::interval)
			RETURNING id::text
		`, room.ID, testWorkspaceID, authorType, authorID, content, age).Scan(&id)
		return id
	}
	insert("member", testUserID, "last week deploy notes", "4 minutes")
	fileID := insert("member", testUserID, "![shot.png](https://example.test/shot.png)", "3 minutes")
	dbfx.Insert(t, "attachment", testutil.Cols{
		"workspace_id": testWorkspaceID, "issue_id": room.ID, "comment_id": fileID,
		"uploader_type": "member", "uploader_id": testUserID,
		"filename": "shot.png", "url": "https://example.test/shot.png",
		"content_type": "image/png", "size_bytes": 1,
	})
	insert("agent", agentID, "on it", "2 minutes")
	insert("member", testUserID, "and the logs", "1 minute")
	checkID := insert("member", testUserID, "please check the deploy", "1 second")

	ev := &groupChatFilterEvaluator{choice: "屏蔽"}
	prev := testHandler.GroupChatDecider
	testHandler.GroupChatDecider = ev
	t.Cleanup(func() { testHandler.GroupChatDecider = prev })

	issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(room.ID))
	if err != nil {
		t.Fatal(err)
	}
	var resp AgentTaskResponse
	testHandler.attachGroupChatTranscript(ctx, &resp, issue, db.AgentTaskQueue{
		AgentID:          parseUUID(agentID),
		TriggerCommentID: parseUUID(checkID),
	})
	xml := resp.GroupChatTranscript
	if strings.Contains(xml, "last week deploy notes") || strings.Contains(xml, ">on it</msg>") {
		t.Fatalf("unrelated messages stayed visible:\n%s", xml)
	}
	if !strings.Contains(xml, "and the logs") || !strings.Contains(xml, "please check the deploy") || !strings.Contains(xml, "shot.png") {
		t.Fatalf("the check burst or the attachment was hidden:\n%s", xml)
	}
	if strings.Count(xml, "<msg ") != 5 || strings.Count(xml, ">"+groupchat.HiddenMessageText+"</msg>") != 2 {
		t.Fatalf("hidden messages were dropped instead of replaced:\n%s", xml)
	}
	if !strings.Contains(xml, `id="`+fileID+`"`) {
		t.Fatalf("attachment message lost its id:\n%s", xml)
	}
	if ev.state.Agent.Name != "filter-transcript-agent" || len(ev.questions) != 2 {
		t.Fatalf("filter call state=%+v questions=%d", ev.state.Agent, len(ev.questions))
	}
	for _, message := range ev.state.Messages {
		if message.Content == "please check the deploy" || message.Content == "and the logs" {
			if _, ok := ev.questions[fmt.Sprintf("m%d", message.Index)]; ok {
				t.Fatalf("protected message %d was submitted: %+v", message.Index, ev.questions)
			}
		}
	}
}

func TestGroupChatSupplementCancelsTheUnfinishedTask(t *testing.T) {
	ev := &groupChatFilterEvaluator{choice: "追加"}
	prev := testHandler.GroupChatDecider
	testHandler.GroupChatDecider = ev
	t.Cleanup(func() { testHandler.GroupChatDecider = prev })

	queued := newSupersedeChat(t, "supersede-queued")
	postSupersede(t, queued, "check the deploy")
	postSupersede(t, queued, "and include the logs")
	if n := taskStatusCount(t, queued, "cancelled"); n != 1 {
		t.Fatalf("cancelled queued tasks = %d, want 1", n)
	}
	if n := taskStatusCount(t, queued, "queued"); n != 1 {
		t.Fatalf("replacement queued tasks = %d, want 1", n)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND status = 'queued' AND force_fresh_session`, queued); n != 0 {
		t.Fatalf("a queued request that never started forced a fresh session")
	}
	assertOnlyNewThinking := func(chatID string) {
		t.Helper()
		if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE issue_id = $1 AND author_type = 'agent'`, chatID); n != 1 {
			t.Fatalf("agent messages = %d, want only the replacement's thinking bubble", n)
		}
		if n := dbfx.Count(t, `
			SELECT count(*) FROM comment c
			JOIN agent_task_queue q ON q.id = c.source_task_id
			WHERE c.issue_id = $1 AND c.content = $2 AND q.status = 'queued'`, chatID, groupchat.ThinkingMessage); n != 1 {
			t.Fatalf("the replacement has no thinking bubble")
		}
	}
	assertOnlyNewThinking(queued)
	assertCancelledNotice(t, queued, "check the deploy")

	running := newSupersedeChat(t, "supersede-running")
	postSupersede(t, running, "check the deploy")
	dbfx.Exec(t, `UPDATE agent_task_queue SET status = 'running', started_at = now() WHERE issue_id = $1 AND status = 'queued'`, running)
	postSupersede(t, running, "and include the logs")
	if n := taskStatusCount(t, running, "cancelled"); n != 1 {
		t.Fatalf("cancelled running tasks = %d, want 1", n)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND status = 'queued' AND force_fresh_session`, running); n != 1 {
		t.Fatalf("replacement of a started run did not force a fresh session")
	}
	assertOnlyNewThinking(running)
	assertCancelledNotice(t, running, "check the deploy")
}

func assertCancelledNotice(t *testing.T, chatID, trigger string) {
	t.Helper()
	var content string
	dbfx.QueryRow(t, `SELECT content FROM comment WHERE issue_id = $1 AND author_type = 'system' AND type = 'system'`, chatID).Scan(&content)
	if !strings.Contains(content, `"trigger":"`+trigger+`"`) {
		t.Fatalf("cancellation notice = %q, want trigger %q", content, trigger)
	}
}

func TestGroupChatNewQuestionLeavesTheUnfinishedTask(t *testing.T) {
	ev := &groupChatFilterEvaluator{choice: "新问题"}
	prev := testHandler.GroupChatDecider
	testHandler.GroupChatDecider = ev
	t.Cleanup(func() { testHandler.GroupChatDecider = prev })

	chat := newSupersedeChat(t, "supersede-new-question")
	postSupersede(t, chat, "check the deploy")
	dbfx.Exec(t, `UPDATE agent_task_queue SET status = 'running', started_at = now() WHERE issue_id = $1 AND status = 'queued'`, chat)
	postSupersede(t, chat, "what is for lunch")
	if n := taskStatusCount(t, chat, "running"); n != 1 {
		t.Fatalf("running tasks = %d, want 1", n)
	}
	if n := taskStatusCount(t, chat, "queued"); n != 1 {
		t.Fatalf("queued tasks = %d, want 1", n)
	}
	if n := taskStatusCount(t, chat, "cancelled"); n != 0 {
		t.Fatalf("cancelled tasks = %d, want 0", n)
	}
}

func TestGroupChatFinishedReplyIsNotSuperseded(t *testing.T) {
	ev := &groupChatFilterEvaluator{choice: "追加"}
	prev := testHandler.GroupChatDecider
	testHandler.GroupChatDecider = ev
	t.Cleanup(func() { testHandler.GroupChatDecider = prev })

	chat := newSupersedeChat(t, "supersede-replied")
	postSupersede(t, chat, "check the deploy")
	dbfx.Exec(t, `UPDATE agent_task_queue SET status = 'running', started_at = now(), context = jsonb_set(COALESCE(context, '{}'), '{group_chat_placeholder,open}', 'false') WHERE issue_id = $1`, chat)
	postSupersede(t, chat, "and include the logs")
	if n := taskStatusCount(t, chat, "running"); n != 1 {
		t.Fatalf("running tasks = %d, want 1", n)
	}
	if n := taskStatusCount(t, chat, "cancelled"); n != 0 {
		t.Fatalf("cancelled tasks = %d, want 0", n)
	}
	if n := taskStatusCount(t, chat, "queued"); n != 1 {
		t.Fatalf("queued tasks = %d, want 1", n)
	}
}

func newAgentChat(t *testing.T, agentName string) (string, string) {
	t.Helper()
	agentID := createHandlerTestAgent(t, agentName, nil)
	var chat GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   agentName,
		"members": []map[string]string{{"member_type": "agent", "member_id": agentID}},
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		ctx := context.Background()
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})
	return chat.ID, agentID
}

func newSupersedeChat(t *testing.T, agentName string) string {
	t.Helper()
	chatID, _ := newAgentChat(t, agentName)
	return chatID
}

func postSupersede(t *testing.T, chatID, content string) {
	t.Helper()
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chatID+"/comments", map[string]string{
		"content": content,
	}), "id", chatID)).Want(http.StatusCreated)
}

func taskStatusCount(t *testing.T, chatID, status string) int {
	t.Helper()
	return dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND status = $2`, chatID, status)
}

func TestGroupChatReplyQuotesTheTriggerMessage(t *testing.T) {
	ctx := context.Background()
	agentID := createHandlerTestAgent(t, "reply-ref-agent", nil)
	var chat GroupChatResponse
	testutil.Call(t, testHandler.CreateGroupChat, groupChatRequestAs(t, testUserID, "POST", "/api/group-chats", map[string]any{
		"title":   "Reply ref",
		"members": []map[string]string{{"member_type": "agent", "member_id": agentID}},
	})).Want(http.StatusCreated).JSON(&chat)
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, chat.ID)
		}
	})

	var trigger CommentResponse
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chat.ID+"/comments", map[string]string{
		"content": "please check the deploy",
	}), "id", chat.ID)).Want(http.StatusCreated).JSON(&trigger)
	if trigger.RefMessageID != nil {
		t.Fatalf("the question quoted %v", *trigger.RefMessageID)
	}

	var thinkingID, refID string
	dbfx.QueryRow(t, `SELECT id::text, ref_message_id::text FROM comment WHERE issue_id = $1 AND content = $2`, chat.ID, groupchat.ThinkingMessage).Scan(&thinkingID, &refID)
	if refID != trigger.ID {
		t.Fatalf("thinking ref = %q, want %s", refID, trigger.ID)
	}
	var taskID string
	dbfx.QueryRow(t, `SELECT id::text FROM agent_task_queue WHERE issue_id = $1 AND trigger_comment_id = $2`, chat.ID, trigger.ID).Scan(&taskID)

	reply := postGroupChatAsAgent(t, chat.ID, agentID, taskID, map[string]any{"content": "the deploy failed in the logs"})
	if reply.ID == thinkingID || reply.RefMessageID == nil || *reply.RefMessageID != trigger.ID {
		t.Fatalf("reply id=%s ref=%v, want a new comment quoting %s", reply.ID, reply.RefMessageID, trigger.ID)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE id = $1`, thinkingID); n != 0 {
		t.Fatalf("thinking comment still exists")
	}

	follow := postGroupChatAsAgent(t, chat.ID, agentID, taskID, map[string]any{"content": "and the metrics look normal"})
	if follow.ID == thinkingID || follow.RefMessageID == nil || *follow.RefMessageID != trigger.ID {
		t.Fatalf("follow-up id=%s ref=%v, want a new comment quoting %s", follow.ID, follow.RefMessageID, trigger.ID)
	}

	other := dbfx.Comment(t, chat.ID, "an older note")
	chosen := postGroupChatAsAgent(t, chat.ID, agentID, taskID, map[string]any{"content": "about that note", "ref_message_id": other})
	if chosen.RefMessageID == nil || *chosen.RefMessageID != other {
		t.Fatalf("explicit ref = %v, want %s", chosen.RefMessageID, other)
	}
}

func TestGroupChatRunOutputReplacesThinkingWithANewMessage(t *testing.T) {
	ctx := context.Background()
	chatID, _ := newAgentChat(t, "reply-output-agent")
	var trigger CommentResponse
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chatID+"/comments", map[string]string{
		"content": "check the logs",
	}), "id", chatID)).Want(http.StatusCreated).JSON(&trigger)

	var thinkingID, taskID string
	dbfx.QueryRow(t, `SELECT id::text FROM comment WHERE issue_id = $1 AND content = $2`, chatID, groupchat.ThinkingMessage).Scan(&thinkingID)
	dbfx.QueryRow(t, `SELECT id::text FROM agent_task_queue WHERE issue_id = $1 AND trigger_comment_id = $2`, chatID, trigger.ID).Scan(&taskID)
	dbfx.Exec(t, `UPDATE agent_task_queue SET status = 'running', started_at = now() WHERE id = $1`, taskID)

	if _, err := testHandler.TaskService.CompleteTask(ctx, parseUUID(taskID), completeResult(t, "the logs show a timeout"), "", "", "", false, "", ""); err != nil {
		t.Fatalf("complete task: %v", err)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE id = $1`, thinkingID); n != 0 {
		t.Fatalf("thinking comment still exists")
	}
	var replyID, refID string
	dbfx.QueryRow(t, `SELECT id::text, ref_message_id::text FROM comment WHERE issue_id = $1 AND content = $2`, chatID, "the logs show a timeout").Scan(&replyID, &refID)
	if replyID == "" || replyID == thinkingID || refID != trigger.ID {
		t.Fatalf("reply id=%s ref=%s, want a new comment quoting %s", replyID, refID, trigger.ID)
	}
}

func TestGroupChatCancelReplacesThinkingWithANewMessage(t *testing.T) {
	chatID, _ := newAgentChat(t, "reply-cancel-agent")
	var trigger CommentResponse
	testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chatID+"/comments", map[string]string{
		"content": "check the logs",
	}), "id", chatID)).Want(http.StatusCreated).JSON(&trigger)

	var thinkingID, taskID string
	dbfx.QueryRow(t, `SELECT id::text FROM comment WHERE issue_id = $1 AND content = $2`, chatID, groupchat.ThinkingMessage).Scan(&thinkingID)
	dbfx.QueryRow(t, `SELECT id::text FROM agent_task_queue WHERE issue_id = $1 AND trigger_comment_id = $2`, chatID, trigger.ID).Scan(&taskID)

	if _, err := testHandler.TaskService.CancelTask(context.Background(), parseUUID(taskID)); err != nil {
		t.Fatalf("cancel task: %v", err)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE id = $1`, thinkingID); n != 0 {
		t.Fatalf("thinking comment still exists")
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE issue_id = $1 AND author_type = 'agent' AND content <> $2`, chatID, groupchat.ThinkingMessage); n != 1 {
		t.Fatalf("outcome messages = %d, want 1", n)
	}
}

func postGroupChatAsAgent(t *testing.T, chatID, agentID, taskID string, body map[string]any) CommentResponse {
	t.Helper()
	req := groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+chatID+"/comments", body)
	req.Header.Set("X-Agent-ID", agentID)
	req.Header.Set("X-Task-ID", taskID)
	var resp CommentResponse
	testutil.Call(t, testHandler.CreateComment, withURLParam(req, "id", chatID)).Want(http.StatusCreated).JSON(&resp)
	return resp
}
