package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestListIMindChatsKeepsJoinedMetadataWhenSourceUnavailable(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "iMind"), 0o755); err != nil {
		t.Fatal(err)
	}
	note, err := imind.New("note", "source", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := note.Markdown()
	if err != nil {
		t.Fatal(err)
	}
	notePath := filepath.Join(root, "iMind", "source.md")
	if err := os.WriteFile(notePath, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{DaemonID: "persistent-chat-list", Machine: "list-source", OwnerUserID: testUserID, WorkspaceID: testWorkspaceID, Visibility: fileshare.VisibilityWorkspace, Enabled: true}, root)
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h := *testHandler
	h.FileShares = hub
	guest := groupChatWorkspaceMember(t, "Source chat guest", "source-chat-guest@multica.test")
	outsider := groupChatWorkspaceMember(t, "Source chat outsider", "source-chat-outsider@multica.test")
	issueID := dbfx.Issue(t, "iMind · persistent chat", testutil.Cols{"description": "Protected announcement"})
	for _, userID := range []string{testUserID, guest} {
		dbfx.InsertNoID(t, "issue_member", testutil.Cols{"issue_id": issueID, "workspace_id": testWorkspaceID, "member_type": "member", "member_id": userID}, "issue_id=$1 AND member_type='member' AND member_id=$2", issueID, userID)
	}
	dbfx.InsertNoID(t, "imind_group_chat", testutil.Cols{"workspace_id": testWorkspaceID, "share_root_id": imindShareRootID(peer.Meta()), "share_machine": peer.Meta().Machine, "note_id": note.ID, "issue_id": issueID}, "issue_id=$1", issueID)
	dbfx.Comment(t, issueID, "Protected message preview")
	list := func(userID string) *GroupChatResponse {
		t.Helper()
		var out struct {
			Chats []GroupChatResponse `json:"chats"`
		}
		testutil.Call(t, h.ListGroupChats, groupChatRequestAs(t, userID, http.MethodGet, "/api/group-chats", nil)).Want(http.StatusOK).JSON(&out)
		for i := range out.Chats {
			if out.Chats[i].ID == issueID {
				return &out.Chats[i]
			}
		}
		return nil
	}
	check := func(userID string, canRead bool) {
		t.Helper()
		chat := list(userID)
		if chat == nil {
			t.Fatal("joined file chat disappeared from the conversation list")
		}
		if chat.Title != "iMind · persistent chat" || len(chat.Members) != 2 {
			t.Fatalf("chat metadata changed: %+v", chat)
		}
		if canRead {
			if chat.LastMessage == nil || chat.LastMessage.Content != "Protected message preview" || chat.Description != "Protected announcement" {
				t.Fatalf("authorized preview missing: %+v", chat)
			}
		} else {
			if chat.LastMessage != nil || chat.Description != "" || len(chat.PendingSpeakers) != 0 || chat.UnreadCount != 0 {
				t.Fatalf("unavailable source leaked protected details: %+v", chat)
			}
			if got := h.FilterIMindChatAudience(t.Context(), issueID, []string{userID}); len(got) != 0 {
				t.Fatalf("unavailable file still receives realtime: %v", got)
			}
			testutil.Call(t, h.GetIssue, withURLParam(groupChatRequestAs(t, userID, http.MethodGet, "/api/issues/"+issueID, nil), "id", issueID)).Want(http.StatusNotFound)
		}
	}
	check(guest, true)
	hub.Unregister(peer)
	check(guest, false)
	check(testUserID, false)
	if chat := list(outsider); chat != nil {
		t.Fatal("nonmember sees a joined chat")
	}
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	check(guest, true)
	if err := os.WriteFile(notePath, []byte("temporarily invalid Markdown"), 0o644); err != nil {
		t.Fatal(err)
	}
	check(guest, false)
	if err := os.WriteFile(notePath, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	check(guest, true)
	visibility := fileshare.VisibilityPrivate
	if _, err := hub.UpdateAccess(testUserID, peer.Meta().DaemonID, fileshare.AccessPatch{Visibility: &visibility}); err != nil {
		t.Fatal(err)
	}
	check(guest, false)
	check(testUserID, true)
	enabled := false
	if _, err := hub.UpdateAccess(testUserID, peer.Meta().DaemonID, fileshare.AccessPatch{Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	check(testUserID, false)
}
