package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func iMindRequest(method, target, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("X-User-ID", "owner-1")
	return req.WithContext(middleware.SetMemberContext(req.Context(), "ws-1", db.Member{}))
}

func iMindNoteRequest(method, target, id, body string) *http.Request {
	req := iMindRequest(method, target, body)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

func TestIMindCreatesFixedDirectoryAndListsNotes(t *testing.T) {
	h := iMindTestHandler(t, t.TempDir())

	bootstrap := httptest.NewRecorder()
	h.PostIMindBootstrap(bootstrap, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
	var boot map[string]string
	decodeDocs(t, bootstrap, http.StatusOK, &boot)
	if boot["path"] != "mbp/iMind" {
		t.Fatalf("bootstrap = %#v", boot)
	}

	create := httptest.NewRecorder()
	h.PostIMindNotes(create, iMindRequest(http.MethodPost, "/api/imind/notes", `{
		"share_machine":"mbp",
		"type":"recording",
		"title":"产品周会",
		"tags":["工作"],
		"content":"# 产品周会",
		"audio":{"duration_ms":1200,"format":"pcm_s16le","sample_rate_hz":16000}
	}`))
	var created iMindNoteResponse
	decodeDocs(t, create, http.StatusCreated, &created)
	if !strings.HasPrefix(created.Path, "mbp/iMind/") || created.ID == "" || created.Revision == "" {
		t.Fatalf("created = %#v", created)
	}

	list := httptest.NewRecorder()
	h.PostIMindNotesList(list, iMindRequest(http.MethodPost, "/api/imind/notes/list", `{"share_machine":"mbp","tag":"工作"}`))
	var result struct {
		Notes []iMindNoteResponse `json:"notes"`
	}
	decodeDocs(t, list, http.StatusOK, &result)
	if len(result.Notes) != 1 || result.Notes[0].ID != created.ID || result.Notes[0].Title != "产品周会" {
		t.Fatalf("list = %#v", result)
	}

	update := httptest.NewRecorder()
	h.PutIMindNote(update, iMindNoteRequest(http.MethodPut, "/api/imind/notes/"+created.ID, created.ID, `{
		"share_machine":"mbp",
		"revision":"`+created.Revision+`",
		"title":"产品周会（已整理）",
		"tags":["工作"],
		"content":"# 已整理",
		"transcript":"<!-- transcript: 00:00.000 -->\n会议开始"
	}`))
	var updated iMindNoteResponse
	decodeDocs(t, update, http.StatusOK, &updated)
	if updated.Title != "产品周会（已整理）" || updated.Revision == created.Revision {
		t.Fatalf("updated = %#v", updated)
	}

	deleteW := httptest.NewRecorder()
	h.DeleteIMindNote(deleteW, iMindNoteRequest(http.MethodDelete, "/api/imind/notes/"+created.ID, created.ID, `{"share_machine":"mbp","revision":"`+updated.Revision+`"}`))
	var deleted map[string]string
	decodeDocs(t, deleteW, http.StatusOK, &deleted)
	if deleted["id"] != created.ID {
		t.Fatalf("delete = %#v", deleted)
	}
}

func iMindTestHandler(t *testing.T, root string) *Handler {
	t.Helper()
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{DaemonID: "daemon-1", Machine: "mbp", OwnerUserID: "owner-1", WorkspaceID: "ws-1", Visibility: fileshare.VisibilityPrivate, Enabled: true}, root)
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	return &Handler{FileShares: hub}
}

func TestIMindShareScope(t *testing.T) {
	h := iMindTestHandler(t, t.TempDir())
	for _, name := range []string{"other workspace", "missing workspace", "stranger", "disabled"} {
		t.Run(name, func(t *testing.T) {
			r := iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`)
			switch name {
			case "other workspace":
				r = r.WithContext(middleware.SetMemberContext(r.Context(), "ws-2", db.Member{}))
			case "missing workspace":
				r = r.WithContext(context.Background())
				r.Header.Set("X-Workspace-ID", "ws-1")
			case "stranger":
				r.Header.Set("X-User-ID", "stranger")
			case "disabled":
				enabled := false
				_, _ = h.FileShares.UpdateAccess("owner-1", "daemon-1", fileshare.AccessPatch{Enabled: &enabled})
			}
			w := httptest.NewRecorder()
			h.PostIMindBootstrap(w, r)
			if w.Code != http.StatusNotFound {
				t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
			}
			list := httptest.NewRecorder()
			h.GetIMindShares(list, r)
			if strings.Contains(list.Body.String(), `"machine":"mbp"`) {
				t.Fatal("share leaked")
			}
		})
	}
}

func TestIMindRejectsInvalidBody(t *testing.T) {
	cases := []string{
		`null`,
		`{"share_machine":"mbp","type":"note","title":"title","content":null}`,
		`{"share_machine":"mbp","type":"note","title":"title","transcript":null}`,
		`{"share_machine":"mbp","type":"note","title":"title","tags":[null]}`,
		`{"share_machine":"mbp","type":"recording","title":"title","audio":{"duration_ms":null,"format":"pcm_s16le","sample_rate_hz":16000}}`,
		`{"share_machine":"mbp","type":"note","title":"title","path":"../outside.md"}`,
		`{"share_machine":"mbp","type":"note","title":"title","created_at":"2026-10-27T00:00:00Z"}`,
		`{"share_machine":"mbp","type":"note","title":"title","updated_at":"2026-10-27T00:00:00Z"}`,
		`{"share_machine":"mbp","type":"note","title":"one","title":"two"}`,
		`{"share_machine":"mbp","type":"note","title":"one","Title":"two"}`,
		`{"share_machine":"mbp","type":"note","title":"title"} {}`,
		`{"share_machine":"mbp","type":"recording","title":"title","audio":{"duration_ms":0,"duration_ms":1,"format":"pcm_s16le","sample_rate_hz":16000}}`,
		`{"share_machine":"mbp","type":"recording","title":"title","audio":{"format":"pcm_s16le","sample_rate_hz":16000,"path":"a.wav"}}`,
		`{"share_machine":"mbp","type":"other","title":"title"}`,
		`{"share_machine":"mbp","type":"note","title":42}`,
		`{"share_machine":"mbp","type":"note","title":"title","content":"<!-- imind:content:end -->"}`,
		`{"share_machine":"mbp","type":"note","title":"title","transcript":"text"}`,
	}
	for _, body := range cases {
		w := httptest.NewRecorder()
		h := iMindTestHandler(t, t.TempDir())
		h.PostIMindNotes(w, iMindRequest(http.MethodPost, "/api/imind/notes", body))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body = %s status = %d response = %s", body, w.Code, w.Body.String())
		}
	}
}

func TestIMindRejectsInvalidIDsBeforeReading(t *testing.T) {
	h := iMindTestHandler(t, t.TempDir())
	for _, id := range []string{"", "../outside", "/tmp/note", `..\outside`, "00000000-0000-0000-0000-000000000000", "not-a-uuid"} {
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
			body, _ := json.Marshal(map[string]string{"share_machine": "mbp", "id": id})
			w := httptest.NewRecorder()
			r := iMindNoteRequest(method, "/api/imind/notes/get", id, string(body))
			if method != http.MethodPost {
				r.Body = io.NopCloser(strings.NewReader(`{"share_machine":"mbp","revision":"old","title":"title"}`))
			}
			switch method {
			case http.MethodPost:
				h.PostIMindNote(w, r)
			case http.MethodPut:
				h.PutIMindNote(w, r)
			case http.MethodDelete:
				r.Body = io.NopCloser(strings.NewReader(`{"share_machine":"mbp","revision":"old"}`))
				h.DeleteIMindNote(w, r)
			}
			if w.Code != http.StatusBadRequest {
				t.Fatalf("%s %q: status %d body %s", method, id, w.Code, w.Body.String())
			}
		}
	}
}

func TestIMindListsReadableFilenames(t *testing.T) {
	root := t.TempDir()
	h := iMindTestHandler(t, root)
	if err := os.Mkdir(filepath.Join(root, iMindDir), 0o755); err != nil {
		t.Fatal(err)
	}
	first, _ := imind.New("note", "first", time.Now())
	raw, _ := first.Markdown()
	for _, name := range []string{"renamed.md"} {
		if err := os.WriteFile(filepath.Join(root, iMindDir, name), []byte(raw), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	w := httptest.NewRecorder()
	h.PostIMindNotesList(w, iMindRequest(http.MethodPost, "/api/imind/notes/list", `{"share_machine":"mbp"}`))
	var out struct {
		Notes []iMindNoteResponse `json:"notes"`
	}
	decodeDocs(t, w, http.StatusOK, &out)
	if len(out.Notes) != 1 || out.Notes[0].ID != first.ID {
		t.Fatalf("notes = %#v", out.Notes)
	}
}

func TestIMindConcurrentUpdatesAndStaleDelete(t *testing.T) {
	h := iMindTestHandler(t, t.TempDir())
	create := httptest.NewRecorder()
	h.PostIMindNotes(create, iMindRequest(http.MethodPost, "/api/imind/notes", `{"share_machine":"mbp","type":"note","title":"title"}`))
	var original iMindNoteResponse
	decodeDocs(t, create, http.StatusCreated, &original)
	results := make(chan *httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for _, title := range []string{"first", "second"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			body, _ := json.Marshal(map[string]string{"share_machine": "mbp", "revision": original.Revision, "title": title})
			h.PutIMindNote(w, iMindNoteRequest(http.MethodPut, "/api/imind/notes/"+original.ID, original.ID, string(body)))
			results <- w
		}()
	}
	wg.Wait()
	close(results)
	var revision string
	conflicts := 0
	for w := range results {
		if w.Code == http.StatusOK {
			var note iMindNoteResponse
			decodeDocs(t, w, http.StatusOK, &note)
			revision = note.Revision
		} else {
			var conflict map[string]string
			decodeDocs(t, w, http.StatusConflict, &conflict)
			if conflict["code"] != "imind_conflict" || conflict["revision"] == "" {
				t.Fatalf("conflict = %#v", conflict)
			}
			conflicts++
		}
	}
	if conflicts != 1 || revision == "" {
		t.Fatalf("conflicts = %d revision = %q", conflicts, revision)
	}
	w := httptest.NewRecorder()
	h.DeleteIMindNote(w, iMindNoteRequest(http.MethodDelete, "/api/imind/notes/"+original.ID, original.ID, `{"share_machine":"mbp","revision":"`+original.Revision+`"}`))
	var conflict map[string]string
	decodeDocs(t, w, http.StatusConflict, &conflict)
	if conflict["revision"] != revision {
		t.Fatalf("conflict = %#v", conflict)
	}
}

type iMindWriteRacePeer struct {
	fileshare.Peer
	root string
}

func (p *iMindWriteRacePeer) Call(ctx context.Context, op string, payload any, dest any) error {
	if op == fileshare.OpWrite || op == fileshare.OpDelete {
		var rel string
		if op == fileshare.OpWrite {
			rel = payload.(obsidianvault.EditRequest).Path
		} else {
			rel = payload.(map[string]string)["path"]
		}
		current, err := obsidianvault.Read(ctx, p.root, rel)
		if err != nil {
			return err
		}
		note, err := imind.Parse(current.Content, "title")
		if err != nil {
			return err
		}
		note.Content = "external writer"
		raw, err := note.Markdown()
		if err != nil {
			return err
		}
		if op == fileshare.OpDelete {
			if err := os.WriteFile(filepath.Join(p.root, filepath.FromSlash(rel)), []byte(raw), 0o644); err != nil {
				return err
			}
		} else if _, err := obsidianvault.Apply(ctx, p.root, obsidianvault.EditRequest{Path: rel, Op: "overwrite", Content: raw, BaseRevision: current.Revision}); err != nil {
			return err
		}
	}
	return p.Peer.Call(ctx, op, payload, dest)
}

func TestIMindWriteRaceReturnsCurrentRevision(t *testing.T) {
	root := t.TempDir()
	h := iMindTestHandler(t, root)
	create := httptest.NewRecorder()
	h.PostIMindNotes(create, iMindRequest(http.MethodPost, "/api/imind/notes", `{"share_machine":"mbp","type":"note","title":"title"}`))
	var original iMindNoteResponse
	decodeDocs(t, create, http.StatusCreated, &original)
	peer := &iMindWriteRacePeer{Peer: h.FileShares.Get("mbp"), root: root}
	if err := h.FileShares.Register(peer); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.PutIMindNote(w, iMindNoteRequest(http.MethodPut, "/api/imind/notes/"+original.ID, original.ID, `{"share_machine":"mbp","revision":"`+original.Revision+`","title":"lost update"}`))
	var conflict map[string]string
	decodeDocs(t, w, http.StatusConflict, &conflict)
	current, err := obsidianvault.Read(t.Context(), root, strings.TrimPrefix(original.Path, "mbp/"))
	if err != nil {
		t.Fatal(err)
	}
	if conflict["code"] != "imind_conflict" || conflict["revision"] != current.Revision || !strings.Contains(current.Content, "external writer") {
		t.Fatalf("conflict = %#v current = %#v", conflict, current)
	}
}

func TestIMindSocketDeleteCASAndScope(t *testing.T) {
	root := t.TempDir()
	h := &Handler{FileShares: fileshare.NewHub()}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("X-User-ID", "owner-1")
		h.ConnectFileShare(w, r)
	}))
	defer srv.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(fileshare.Envelope{Type: "hello", DaemonID: "daemon-1", Machine: "mbp", WorkspaceID: "ws-1", Visibility: fileshare.VisibilityPrivate, IMindScopeRevision: true, IMindRename: true}); err != nil {
		t.Fatal(err)
	}
	var ready fileshare.Envelope
	if err := conn.ReadJSON(&ready); err != nil || ready.Type != "ready" {
		t.Fatalf("ready = %#v, err = %v", ready, err)
	}
	serveCtx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- fileshare.ServeConn(serveCtx, conn, root, nil) }()
	defer func() {
		cancel()
		_ = conn.Close()
		<-done
	}()
	create := httptest.NewRecorder()
	h.PostIMindNotes(create, iMindRequest(http.MethodPost, "/api/imind/notes", `{"share_machine":"mbp","type":"note","title":"title"}`))
	var original iMindNoteResponse
	decodeDocs(t, create, http.StatusCreated, &original)
	peer := &iMindWriteRacePeer{Peer: h.FileShares.Get("mbp"), root: root}
	scopedHandler := &Handler{FileShares: fileshare.NewHub()}
	if err := scopedHandler.FileShares.Register(peer); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	scopedHandler.DeleteIMindNote(w, iMindNoteRequest(http.MethodDelete, "/api/imind/notes/"+original.ID, original.ID, `{"share_machine":"mbp","revision":"`+original.Revision+`"}`))
	var conflict map[string]string
	decodeDocs(t, w, http.StatusConflict, &conflict)
	current, err := obsidianvault.Read(t.Context(), root, strings.TrimPrefix(original.Path, "mbp/"))
	if err != nil || conflict["revision"] != current.Revision || conflict["code"] != "imind_conflict" {
		t.Fatalf("wire conflict = %#v current = %#v err = %v", conflict, current, err)
	}
	if err := os.Rename(filepath.Join(root, iMindDir), filepath.Join(root, "other")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "other"), filepath.Join(root, iMindDir)); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	scopedHandler.PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("wire scope = %d %s", w.Code, w.Body.String())
	}
}

func TestIMindDeleteRaceReturnsCurrentRevisionAndPreservesNote(t *testing.T) {
	root := t.TempDir()
	h := iMindTestHandler(t, root)
	create := httptest.NewRecorder()
	h.PostIMindNotes(create, iMindRequest(http.MethodPost, "/api/imind/notes", `{"share_machine":"mbp","type":"note","title":"title"}`))
	var original iMindNoteResponse
	decodeDocs(t, create, http.StatusCreated, &original)
	peer := &iMindWriteRacePeer{Peer: h.FileShares.Get("mbp"), root: root}
	if err := h.FileShares.Register(peer); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.DeleteIMindNote(w, iMindNoteRequest(http.MethodDelete, "/api/imind/notes/"+original.ID, original.ID, `{"share_machine":"mbp","revision":"`+original.Revision+`"}`))
	var conflict map[string]string
	decodeDocs(t, w, http.StatusConflict, &conflict)
	current, err := obsidianvault.Read(t.Context(), root, strings.TrimPrefix(original.Path, "mbp/"))
	if err != nil {
		t.Fatal(err)
	}
	if conflict["code"] != "imind_conflict" || conflict["revision"] != current.Revision || !strings.Contains(current.Content, "external writer") {
		t.Fatalf("conflict = %#v current = %#v", conflict, current)
	}
}

type iMindLegacyPeer struct {
	fileshare.Peer
	calls int
}

func (p *iMindLegacyPeer) Meta() fileshare.ShareMeta {
	meta := p.Peer.Meta()
	meta.IMindScopeRevision = false
	return meta
}

func (p *iMindLegacyPeer) Call(ctx context.Context, op string, payload any, dest any) error {
	p.calls++
	return p.Peer.Call(ctx, op, payload, dest)
}

func TestIMindLegacyDaemonFailsClosed(t *testing.T) {
	h := iMindTestHandler(t, t.TempDir())
	peer := &iMindLegacyPeer{Peer: h.FileShares.Get("mbp")}
	if err := h.FileShares.Register(peer); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
	var body map[string]string
	decodeDocs(t, w, http.StatusConflict, &body)
	if body["code"] != "imind_daemon_upgrade_required" || peer.calls != 0 {
		t.Fatalf("body = %#v calls = %d", body, peer.calls)
	}
	w = httptest.NewRecorder()
	h.GetIMindShares(w, iMindRequest(http.MethodGet, "/api/imind/shares", ""))
	if strings.Contains(w.Body.String(), `"machine":"mbp"`) {
		t.Fatalf("旧 daemon 出现在 iMind 列表: %s", w.Body.String())
	}
}

func TestIMindRejectsSymlinkDirectoryAndNotes(t *testing.T) {
	root := t.TempDir()
	h := iMindTestHandler(t, root)
	other := filepath.Join(root, "other")
	if err := os.Mkdir(other, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, filepath.Join(root, iMindDir)); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("symlink bootstrap = %d %s", w.Code, w.Body.String())
	}

	root = t.TempDir()
	h = iMindTestHandler(t, root)
	note, err := imind.New("note", "external note", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := note.Markdown()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, note.ID+".md"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, iMindDir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, note.ID+".md"), filepath.Join(root, iMindDir, note.ID+".md")); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		w := httptest.NewRecorder()
		body := `{"share_machine":"mbp","id":"` + note.ID + `"}`
		if method == http.MethodPut {
			body = `{"share_machine":"mbp","revision":"old","title":"lost"}`
		} else if method == http.MethodDelete {
			body = `{"share_machine":"mbp","revision":"old"}`
		}
		r := iMindNoteRequest(method, "/api/imind/notes/"+note.ID, note.ID, body)
		switch method {
		case http.MethodPost:
			h.PostIMindNote(w, r)
		case http.MethodPut:
			h.PutIMindNote(w, r)
		case http.MethodDelete:
			h.DeleteIMindNote(w, r)
		}
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s symlink note = %d %s", method, w.Code, w.Body.String())
		}
	}
	w = httptest.NewRecorder()
	h.PostIMindNotesList(w, iMindRequest(http.MethodPost, "/api/imind/notes/list", `{"share_machine":"mbp"}`))
	var list struct {
		Notes []iMindNoteResponse `json:"notes"`
	}
	decodeDocs(t, w, http.StatusOK, &list)
	if len(list.Notes) != 0 {
		t.Fatalf("symlink list = %#v", list)
	}
	current, err := os.ReadFile(filepath.Join(root, note.ID+".md"))
	if err != nil || string(current) != raw {
		t.Fatalf("外部笔记改变: %q, %v", current, err)
	}
}

func TestIMindWorkspaceShareUsesValidatedMemberContext(t *testing.T) {
	h := iMindTestHandler(t, t.TempDir())
	visibility := fileshare.VisibilityWorkspace
	if _, err := h.FileShares.UpdateAccess("owner-1", "daemon-1", fileshare.AccessPatch{Visibility: &visibility}); err != nil {
		t.Fatal(err)
	}
	r := iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`)
	r.Header.Set("X-User-ID", "member-2")
	w := httptest.NewRecorder()
	h.PostIMindBootstrap(w, r)
	var boot map[string]string
	decodeDocs(t, w, http.StatusOK, &boot)
	list := httptest.NewRecorder()
	h.GetIMindShares(list, r)
	if !strings.Contains(list.Body.String(), `"machine":"mbp"`) {
		t.Fatalf("workspace share hidden: %s", list.Body.String())
	}
}

func TestIMindBootstrapRejectsNonDirectoryAndIsIdempotent(t *testing.T) {
	root := t.TempDir()
	h := iMindTestHandler(t, root)
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		h.PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
		if w.Code != http.StatusOK {
			t.Fatalf("bootstrap = %d %s", w.Code, w.Body.String())
		}
	}
	other := t.TempDir()
	if err := os.WriteFile(filepath.Join(other, iMindDir), []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	iMindTestHandler(t, other).PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bootstrap file = %d %s", w.Code, w.Body.String())
	}
}

func TestIMindRejectsUnknownShare(t *testing.T) {
	h := iMindTestHandler(t, t.TempDir())
	w := httptest.NewRecorder()
	h.PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"other"}`))
	var body map[string]string
	decodeDocs(t, w, http.StatusNotFound, &body)
	if body["code"] != "imind_share_not_found" {
		t.Fatalf("body = %#v", body)
	}
}

func TestIMindReadableNamesAndDuplicateTitles(t *testing.T) {
	root := t.TempDir()
	h := iMindTestHandler(t, root)
	var notes []iMindNoteResponse
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		h.PostIMindNotes(w, iMindRequest(http.MethodPost, "/api/imind/notes", `{"share_machine":"mbp","type":"note","title":"产品/周会"}`))
		var note iMindNoteResponse
		decodeDocs(t, w, http.StatusCreated, &note)
		notes = append(notes, note)
	}
	if notes[0].Path != "mbp/iMind/产品 周会.md" || notes[1].Path != "mbp/iMind/产品 周会 (2).md" || notes[0].ID == notes[1].ID {
		t.Fatalf("notes = %#v", notes)
	}
	for _, note := range notes {
		w := httptest.NewRecorder()
		h.PostIMindNote(w, iMindRequest(http.MethodPost, "/api/imind/notes/get", `{"share_machine":"mbp","id":"`+note.ID+`"}`))
		var got iMindNoteResponse
		decodeDocs(t, w, http.StatusOK, &got)
		if got.ID != note.ID || got.Path != note.Path {
			t.Fatalf("got = %#v", got)
		}
	}
}

func TestIMindRenameUsesFilenameAndResolvesDuplicates(t *testing.T) {
	root := t.TempDir()
	h := iMindTestHandler(t, root)
	var notes []iMindNoteResponse
	for _, title := range []string{"产品", "周会"} {
		w := httptest.NewRecorder()
		h.PostIMindNotes(w, iMindRequest(http.MethodPost, "/api/imind/notes", `{"share_machine":"mbp","type":"note","title":"`+title+`"}`))
		var n iMindNoteResponse
		decodeDocs(t, w, http.StatusCreated, &n)
		notes = append(notes, n)
	}
	w := httptest.NewRecorder()
	h.PutIMindNote(w, iMindNoteRequest(http.MethodPut, "/api/imind/notes/"+notes[1].ID, notes[1].ID, `{"share_machine":"mbp","revision":"`+notes[1].Revision+`","title":"产品"}`))
	var updated iMindNoteResponse
	decodeDocs(t, w, http.StatusOK, &updated)
	if updated.Title != "产品 (2)" || updated.Path != "mbp/iMind/产品 (2).md" {
		t.Fatalf("updated = %#v", updated)
	}
	raw, err := os.ReadFile(filepath.Join(root, "iMind", "产品 (2).md"))
	if err != nil || strings.Contains(string(raw), "\ntitle:") {
		t.Fatalf("metadata: %v %s", err, raw)
	}
	w = httptest.NewRecorder()
	h.PostIMindNote(w, iMindRequest(http.MethodPost, "/api/imind/notes/get", `{"share_machine":"mbp","id":"`+notes[1].ID+`"}`))
	var got iMindNoteResponse
	decodeDocs(t, w, http.StatusOK, &got)
	if got.Title != updated.Title {
		t.Fatalf("got = %#v", got)
	}
}
