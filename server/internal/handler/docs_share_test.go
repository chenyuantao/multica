package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

func TestDocsMachineShareReadWrite(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("local"), 0o644); err != nil {
		t.Fatal(err)
	}
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{
		DaemonID:    "daemon-1",
		Machine:     "mbp",
		OwnerUserID: "owner-1",
		Visibility:  fileshare.VisibilityPrivate,
		Enabled:     true,
		Dir:         root,
	}, root)
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h := &Handler{FileShares: hub}

	treeReq := httptest.NewRequest(http.MethodPost, "/api/docs/tree", strings.NewReader(`{}`))
	treeReq.Header.Set("X-User-ID", "owner-1")
	treeW := httptest.NewRecorder()
	h.PostDocsTree(treeW, treeReq)
	if treeW.Code != http.StatusOK || !strings.Contains(treeW.Body.String(), `"path":"mbp/note.md"`) {
		t.Fatalf("tree status = %d body = %s", treeW.Code, treeW.Body.String())
	}

	other := httptest.NewRequest(http.MethodPost, "/api/docs/files/content", strings.NewReader(`{"path":"mbp/note.md"}`))
	other.Header.Set("X-User-ID", "someone-else")
	otherW := httptest.NewRecorder()
	h.PostDocsFileContent(otherW, other)
	if otherW.Code != http.StatusNotFound {
		t.Fatalf("stranger status = %d body = %s", otherW.Code, otherW.Body.String())
	}

	readReq := httptest.NewRequest(http.MethodPost, "/api/docs/files/content", strings.NewReader(`{"path":"mbp/note.md"}`))
	readReq.Header.Set("X-User-ID", "owner-1")
	readW := httptest.NewRecorder()
	h.PostDocsFileContent(readW, readReq)
	if readW.Code != http.StatusOK || !strings.Contains(readW.Body.String(), `"content":"local"`) {
		t.Fatalf("read status = %d body = %s", readW.Code, readW.Body.String())
	}

	var note obsidianvault.FileContent
	if err := json.Unmarshal(readW.Body.Bytes(), &note); err != nil {
		t.Fatal(err)
	}
	editReq := httptest.NewRequest(http.MethodPatch, "/api/docs/files/content", strings.NewReader(`{"path":"mbp/note.md","op":"overwrite","content":"remote","base_revision":"`+note.Revision+`"}`))
	editReq.Header.Set("X-User-ID", "owner-1")
	editW := httptest.NewRecorder()
	h.PatchDocsFileContent(editW, editReq)
	if editW.Code != http.StatusOK {
		t.Fatalf("edit status = %d body = %s", editW.Code, editW.Body.String())
	}
	body, err := os.ReadFile(filepath.Join(root, "note.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "remote" {
		t.Fatalf("disk = %q", body)
	}
}

func TestFileShareSocketServesARead(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("via-socket"), 0o644); err != nil {
		t.Fatal(err)
	}
	hub := fileshare.NewHub()
	h := &Handler{FileShares: hub}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("X-User-ID", "owner-1")
		h.ConnectFileShare(w, r)
	}))
	defer srv.Close()

	socketURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(socketURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(fileshare.Envelope{
		Type:       "hello",
		DaemonID:   "daemon-1",
		Machine:    "mbp",
		Visibility: fileshare.VisibilityPrivate,
	}); err != nil {
		t.Fatal(err)
	}
	var ready fileshare.Envelope
	if err := conn.ReadJSON(&ready); err != nil {
		t.Fatal(err)
	}
	if ready.Type != "ready" {
		t.Fatalf("ready = %#v", ready)
	}
	go fileshare.ServeConn(t.Context(), conn, root, nil)

	readReq := httptest.NewRequest(http.MethodPost, "/api/docs/files/content", strings.NewReader(`{"path":"mbp/note.md"}`))
	readReq.Header.Set("X-User-ID", "owner-1")
	readW := httptest.NewRecorder()
	h.PostDocsFileContent(readW, readReq)
	if readW.Code != http.StatusOK || !strings.Contains(readW.Body.String(), "via-socket") {
		t.Fatalf("read status = %d body = %s", readW.Code, readW.Body.String())
	}
	if hub.Get("mbp") == nil {
		t.Fatal("machine was not registered")
	}
	_ = obsidianvault.ErrNotFound
}

func TestFileShareHTTPAccessSwitch(t *testing.T) {
	root := t.TempDir()
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{
		DaemonID:    "daemon-1",
		Machine:     "mbp",
		OwnerUserID: "owner-1",
		WorkspaceID: "ws-1",
		Visibility:  fileshare.VisibilityPrivate,
		Enabled:     true,
		Dir:         root,
		Online:      true,
	}, root)
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h := &Handler{FileShares: hub}
	list := httptest.NewRequest(http.MethodGet, "/api/file-shares", nil)
	list.Header.Set("X-User-ID", "owner-1")
	list.Header.Set("X-Workspace-ID", "ws-1")
	listW := httptest.NewRecorder()
	h.ListFileShares(listW, list)
	if listW.Code != http.StatusOK || !strings.Contains(listW.Body.String(), root) || !strings.Contains(listW.Body.String(), `"online":true`) || !strings.Contains(listW.Body.String(), `"daemon_id":"daemon-1"`) {
		t.Fatalf("list status = %d body = %s", listW.Code, listW.Body.String())
	}

	byName := httptest.NewRequest(http.MethodPatch, "/api/file-shares/mbp", strings.NewReader(`{"enabled":false}`))
	byName.Header.Set("X-User-ID", "owner-1")
	byName = withDaemonParam(byName, "mbp")
	byNameW := httptest.NewRecorder()
	h.UpdateFileShare(byNameW, byName)
	if byNameW.Code != http.StatusNotFound {
		t.Fatalf("patch by path name status = %d body = %s", byNameW.Code, byNameW.Body.String())
	}

	patch := httptest.NewRequest(http.MethodPatch, "/api/file-shares/daemon-1", strings.NewReader(`{"visibility":"workspace","enabled":false}`))
	patch.Header.Set("X-User-ID", "owner-1")
	patch.Header.Set("X-Workspace-ID", "ws-1")
	patch = withDaemonParam(patch, "daemon-1")
	patchW := httptest.NewRecorder()
	h.UpdateFileShare(patchW, patch)
	if patchW.Code != http.StatusOK || !strings.Contains(patchW.Body.String(), `"enabled":false`) || !strings.Contains(patchW.Body.String(), `"visibility":"workspace"`) {
		t.Fatalf("patch status = %d body = %s", patchW.Code, patchW.Body.String())
	}

	stranger := httptest.NewRequest(http.MethodPatch, "/api/file-shares/daemon-1", strings.NewReader(`{"enabled":true}`))
	stranger.Header.Set("X-User-ID", "someone-else")
	stranger = withDaemonParam(stranger, "daemon-1")
	strangerW := httptest.NewRecorder()
	h.UpdateFileShare(strangerW, stranger)
	if strangerW.Code != http.StatusNotFound {
		t.Fatalf("stranger patch status = %d body = %s", strangerW.Code, strangerW.Body.String())
	}

	pathPatch := httptest.NewRequest(http.MethodPatch, "/api/file-shares/daemon-1", strings.NewReader(`{"dir":"/tmp/other"}`))
	pathPatch.Header.Set("X-User-ID", "owner-1")
	pathPatch = withDaemonParam(pathPatch, "daemon-1")
	pathW := httptest.NewRecorder()
	h.UpdateFileShare(pathW, pathPatch)
	if pathW.Code != http.StatusBadRequest {
		t.Fatalf("path status = %d body = %s", pathW.Code, pathW.Body.String())
	}
	if hub.Records("owner-1", "ws-1")[0].Dir != root {
		t.Fatalf("dir changed: %#v", hub.Records("owner-1", "ws-1"))
	}
}

func TestDocsReadOmitsMachineRoot(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "00-自媒体", "草稿")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "笔记.md"), []byte("draft"), 0o644); err != nil {
		t.Fatal(err)
	}
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{
		DaemonID:    "daemon-1",
		Machine:     "mbp",
		OwnerUserID: "owner-1",
		Visibility:  fileshare.VisibilityPrivate,
		Enabled:     true,
		Dir:         root,
	}, root)
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h := &Handler{FileShares: hub}

	for _, path := range []string{"00-自媒体/草稿/笔记.md", "other/00-自媒体/草稿/笔记.md"} {
		body, err := json.Marshal(map[string]string{"path": path})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/docs/files/content", strings.NewReader(string(body)))
		req.Header.Set("X-User-ID", "owner-1")
		rec := httptest.NewRecorder()
		h.PostDocsFileContent(rec, req)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"content":"draft"`) || !strings.Contains(rec.Body.String(), `"path":"mbp/00-自媒体/草稿/笔记.md"`) {
			t.Fatalf("path %s status = %d body = %s", path, rec.Code, rec.Body.String())
		}
	}

	strangerBody, _ := json.Marshal(map[string]string{"path": "00-自媒体/草稿/笔记.md"})
	stranger := httptest.NewRequest(http.MethodPost, "/api/docs/files/content", strings.NewReader(string(strangerBody)))
	stranger.Header.Set("X-User-ID", "someone-else")
	strangerW := httptest.NewRecorder()
	h.PostDocsFileContent(strangerW, stranger)
	if strangerW.Code != http.StatusNotFound {
		t.Fatalf("stranger status = %d body = %s", strangerW.Code, strangerW.Body.String())
	}
}

func withDaemonParam(r *http.Request, daemonID string) *http.Request {
	route := chi.NewRouteContext()
	route.URLParams.Add("daemonId", daemonID)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, route))
}
