package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

// docsShareHandler serves root as the "mbp" share owned by owner-1.
func docsShareHandler(t *testing.T, root string) *Handler {
	t.Helper()
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
	return &Handler{FileShares: hub}
}

func docsRequest(method, target, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("X-User-ID", "owner-1")
	return req
}

func decodeDocs(t *testing.T, w *httptest.ResponseRecorder, want int, out any) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status = %d, want %d; body = %s", w.Code, want, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
		t.Fatal(err)
	}
}

func TestDocsHTTPWithoutSharesIsEmpty(t *testing.T) {
	h := &Handler{FileShares: fileshare.NewHub()}

	treeW := httptest.NewRecorder()
	h.PostDocsTree(treeW, docsRequest(http.MethodPost, "/api/docs/tree", `{}`))
	var tree obsidianvault.TreeResult
	decodeDocs(t, treeW, http.StatusOK, &tree)
	if tree.Nodes == nil || len(tree.Nodes) != 0 {
		t.Fatalf("tree = %#v", tree)
	}

	rootsW := httptest.NewRecorder()
	h.PostDocsChildren(rootsW, docsRequest(http.MethodPost, "/api/docs/children", `{"path":""}`))
	var roots obsidianvault.ChildrenResult
	decodeDocs(t, rootsW, http.StatusOK, &roots)
	if roots.Nodes == nil || len(roots.Nodes) != 0 {
		t.Fatalf("roots = %#v", roots)
	}

	searchW := httptest.NewRecorder()
	h.PostDocsSearch(searchW, docsRequest(http.MethodPost, "/api/docs/search", `{"q":"x"}`))
	var found obsidianvault.SearchResult
	decodeDocs(t, searchW, http.StatusOK, &found)
	if found.Nodes == nil || len(found.Nodes) != 0 {
		t.Fatalf("search = %#v", found)
	}

	// The deployment-wide system/ vault is gone; its paths are plain misses.
	readW := httptest.NewRecorder()
	h.PostDocsFileContent(readW, docsRequest(http.MethodPost, "/api/docs/files/content", `{"path":"system/note.md"}`))
	var body map[string]string
	decodeDocs(t, readW, http.StatusNotFound, &body)
	if body["code"] != "docs_not_found" {
		t.Fatalf("body = %#v", body)
	}
}

func TestDocsHTTPTreeAndSearch(t *testing.T) {
	root := t.TempDir()
	abs := filepath.Join(root, "库/笔记.md")
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte("# 标题\n\n正文关键词\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "忽略.txt"), []byte("正文关键词"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := docsShareHandler(t, root)

	treeW := httptest.NewRecorder()
	h.PostDocsTree(treeW, docsRequest(http.MethodPost, "/api/docs/tree", `{}`))
	var tree obsidianvault.TreeResult
	decodeDocs(t, treeW, http.StatusOK, &tree)
	if len(tree.Nodes) != 1 || tree.Nodes[0].Path != "mbp" {
		t.Fatalf("tree = %#v", tree)
	}
	folder := tree.Nodes[0].Children[0]
	if folder.Name != "库" || folder.Children[0].Path != "mbp/库/笔记.md" {
		t.Fatalf("tree = %#v", tree)
	}

	searchW := httptest.NewRecorder()
	h.PostDocsSearch(searchW, docsRequest(http.MethodPost, "/api/docs/search", `{"q":"关键词"}`))
	var found obsidianvault.SearchResult
	decodeDocs(t, searchW, http.StatusOK, &found)
	if len(found.Nodes) != 1 || found.Nodes[0].Children[0].Path != "mbp/库/笔记.md" {
		t.Fatalf("search = %#v", found)
	}

	emptyW := httptest.NewRecorder()
	h.PostDocsSearch(emptyW, docsRequest(http.MethodPost, "/api/docs/search", `{"q":""}`))
	var body map[string]string
	decodeDocs(t, emptyW, http.StatusBadRequest, &body)
	if body["code"] != "docs_query_required" {
		t.Fatalf("empty query body = %#v", body)
	}
}

func TestDocsHTTPCreate(t *testing.T) {
	h := docsShareHandler(t, t.TempDir())

	body := `{"path":"mbp/新笔记.md","content":"# 新笔记\n"}`
	w := httptest.NewRecorder()
	h.PostDocsFile(w, docsRequest(http.MethodPost, "/api/docs/files", body))
	var note obsidianvault.FileContent
	decodeDocs(t, w, http.StatusCreated, &note)
	if note.Path != "mbp/新笔记.md" || note.Content != "# 新笔记\n" || note.Revision == "" {
		t.Fatalf("note = %#v", note)
	}

	again := httptest.NewRecorder()
	h.PostDocsFile(again, docsRequest(http.MethodPost, "/api/docs/files", body))
	var conflict map[string]string
	decodeDocs(t, again, http.StatusConflict, &conflict)
	if conflict["code"] != "docs_exists" {
		t.Fatalf("duplicate body = %#v", conflict)
	}
}

func TestDocsHTTPMove(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "归档"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "笔记.md"), []byte("正文"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := docsShareHandler(t, root)

	w := httptest.NewRecorder()
	h.PostDocsMove(w, docsRequest(http.MethodPost, "/api/docs/move", `{"path":"mbp/笔记.md","dest":"mbp/归档"}`))
	var moved obsidianvault.MoveResult
	decodeDocs(t, w, http.StatusOK, &moved)
	if moved.From != "mbp/笔记.md" || moved.Path != "mbp/归档/笔记.md" || moved.Type != obsidianvault.TypeFile {
		t.Fatalf("moved = %#v", moved)
	}

	back := httptest.NewRecorder()
	h.PostDocsMove(back, docsRequest(http.MethodPost, "/api/docs/move", `{"path":"mbp/归档/笔记.md","dest":"mbp"}`))
	decodeDocs(t, back, http.StatusOK, &moved)
	if moved.Path != "mbp/笔记.md" {
		t.Fatalf("move to share root = %#v", moved)
	}

	for name, dest := range map[string]string{"into itself": "mbp/归档", "another machine": "other", "no machine": ""} {
		bad := httptest.NewRecorder()
		h.PostDocsMove(bad, docsRequest(http.MethodPost, "/api/docs/move", `{"path":"mbp/归档","dest":"`+dest+`"}`))
		var body map[string]string
		decodeDocs(t, bad, http.StatusBadRequest, &body)
		if body["code"] != "docs_invalid_move" {
			t.Fatalf("%s: body = %#v", name, body)
		}
	}
}

func TestDocsHTTPContentEdit(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := docsShareHandler(t, root)

	readW := httptest.NewRecorder()
	h.PostDocsFileContent(readW, docsRequest(http.MethodPost, "/api/docs/files/content", `{"path":"mbp/note.md"}`))
	var note obsidianvault.FileContent
	decodeDocs(t, readW, http.StatusOK, &note)
	if note.Path != "mbp/note.md" || note.Content != "hello" || note.Revision == "" {
		t.Fatalf("note = %#v", note)
	}

	body := `{"path":"mbp/note.md","base_revision":"` + note.Revision + `","changes":[{"from":5,"insert":"!"}]}`
	editW := httptest.NewRecorder()
	h.PatchDocsFileContent(editW, docsRequest(http.MethodPatch, "/api/docs/files/content", body))
	var updated obsidianvault.FileContent
	decodeDocs(t, editW, http.StatusOK, &updated)
	if updated.Content != "hello!" || updated.Path != "mbp/note.md" {
		t.Fatalf("updated = %#v", updated)
	}
}
