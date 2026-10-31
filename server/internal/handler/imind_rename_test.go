package handler

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestIMindRenameSyncsExistingChatAcrossNoteTypes(t *testing.T) {
	h := *testHandler
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{DaemonID: "rename-sync", Machine: "rename-sync", OwnerUserID: testUserID, WorkspaceID: testWorkspaceID, Visibility: fileshare.VisibilityWorkspace, Enabled: true, IMindScopeRevision: true, IMindRename: true, IMindMedia: true}, t.TempDir())
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h.FileShares = hub
	box, err := secretbox.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	h.IMindSecretBox = box
	testutil.Call(t, h.PutIMindDeepSeek, groupChatRequestAs(t, testUserID, "PUT", "/settings", map[string]string{"api_key": "test-key"})).Want(200)
	dbfx.Cleanup(t, `UPDATE workspace SET imind_deepseek_key=NULL WHERE id=$1`, testWorkspaceID)
	h.IMindNamingHTTP = &http.Client{Transport: imindNamingTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"title\":\"AI title\",\"summary\":\"Summary\"}"}}]}`))}, nil
	})}
	for _, kind := range []string{"note", "clip", "recording"} {
		t.Run(kind, func(t *testing.T) {
			h.Bus = events.New()
			var updates []events.Event
			h.Bus.Subscribe(protocol.EventGroupChatUpdated, func(e events.Event) { updates = append(updates, e) })
			create := func(title string) iMindNoteResponse {
				t.Helper()
				var out iMindNoteResponse
				testutil.Call(t, h.PostIMindNotes, groupChatRequestAs(t, testUserID, "POST", "/notes", map[string]any{"share_machine": "rename-sync", "type": kind, "title": title, "content": "Body"})).Want(201).JSON(&out)
				return out
			}
			note := create("Original " + kind)
			var chat struct {
				IssueID string `json:"issue_id"`
			}
			testutil.Call(t, h.EnsureIMindChat, groupChatRequestAs(t, testUserID, "POST", "/ensure", map[string]string{"share_machine": "rename-sync", "note_id": note.ID, "revision": note.Revision})).Want(200).JSON(&chat)
			dbfx.Cleanup(t, `DELETE FROM imind_group_chat WHERE issue_id=$1`, chat.IssueID)
			// Occupied filenames force the sync to use the actual suffixed filename.
			occupied := create("Occupied " + kind)
			updates = nil
			rename := func(revision, title string, status int) {
				t.Helper()
				req := withURLParam(groupChatRequestAs(t, testUserID, "PUT", "/notes/"+note.ID, map[string]any{"share_machine": "rename-sync", "revision": revision, "title": title, "content": "Updated body"}), "id", note.ID)
				call := testutil.Call(t, h.PutIMindNote, req).Want(status)
				if status == 200 {
					call.JSON(&note)
				}
			}
			assertChat := func(want string, eventCount int) {
				t.Helper()
				issue, err := h.Queries.GetIssue(t.Context(), parseUUID(chat.IssueID))
				if err != nil || issue.Title != "iMind · "+want {
					t.Fatalf("chat title=%q want=%q err=%v", issue.Title, "iMind · "+want, err)
				}
				if len(updates) != eventCount {
					t.Fatalf("updated events=%d want=%d", len(updates), eventCount)
				}
				for _, e := range updates {
					if e.WorkspaceID != testWorkspaceID || e.Payload.(map[string]any)["issue_id"] != chat.IssueID {
						t.Fatalf("wrong update event: %+v", e)
					}
				}
			}
			originalRevision := note.Revision
			rename(note.Revision, occupied.Title, 200)
			if note.Title != occupied.Title+" (2)" {
				t.Fatalf("missing duplicate suffix: %q", note.Title)
			}
			assertChat(note.Title, 1)
			rename(originalRevision, "Rejected title", 409)
			assertChat(note.Title, 1)
			rename(note.Revision, note.Title, 200)
			assertChat(note.Title, 1)
			req := withURLParam(groupChatRequestAs(t, testUserID, "POST", "/ai-name", map[string]string{"share_machine": "rename-sync", "revision": note.Revision}), "id", note.ID)
			testutil.Call(t, h.PostIMindAIName, req).Want(200).JSON(&note)
			assertChat(note.Title, 2)
			if !strings.HasPrefix(note.Title, "AI title") {
				t.Fatalf("AI rename did not run: %q", note.Title)
			}
			if count := dbfx.Count(t, `SELECT count(*) FROM imind_group_chat WHERE workspace_id=$1 AND share_root_id=$2 AND note_id=$3 AND issue_id=$4`, testWorkspaceID, imindShareRootID(peer.Meta()), note.ID, chat.IssueID); count != 1 {
				t.Fatal("rename changed chat binding")
			}
		})
	}
}
