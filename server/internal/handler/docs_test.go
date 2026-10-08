package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

func TestDocsHTTPUnconfigured(t *testing.T) {
	t.Setenv(obsidianvault.EnvVaultPath, "")
	req := httptest.NewRequest(http.MethodPost, "/api/docs/tree", nil)
	w := httptest.NewRecorder()
	(&Handler{}).PostDocsTree(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["code"] != "obsidian_vault_unconfigured" {
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
	t.Setenv(obsidianvault.EnvVaultPath, root)
	h := &Handler{}

	treeReq := httptest.NewRequest(http.MethodPost, "/api/docs/tree", strings.NewReader(`{}`))
	treeW := httptest.NewRecorder()
	h.PostDocsTree(treeW, treeReq)
	if treeW.Code != http.StatusOK {
		t.Fatalf("tree status = %d body = %s", treeW.Code, treeW.Body.String())
	}
	var tree obsidianvault.TreeResult
	if err := json.Unmarshal(treeW.Body.Bytes(), &tree); err != nil {
		t.Fatal(err)
	}
	if len(tree.Nodes) != 1 || tree.Nodes[0].Name != "system" || tree.Nodes[0].Path != "system" {
		t.Fatalf("tree = %#v", tree)
	}
	folder := tree.Nodes[0].Children[0]
	if folder.Name != "库" || folder.Children[0].Name != "笔记.md" || folder.Children[0].Path != "system/库/笔记.md" {
		t.Fatalf("tree = %#v", tree)
	}

	searchReq := httptest.NewRequest(http.MethodPost, "/api/docs/search", strings.NewReader(`{"q":"关键词"}`))
	searchW := httptest.NewRecorder()
	h.PostDocsSearch(searchW, searchReq)
	if searchW.Code != http.StatusOK {
		t.Fatalf("search status = %d body = %s", searchW.Code, searchW.Body.String())
	}
	var found obsidianvault.SearchResult
	if err := json.Unmarshal(searchW.Body.Bytes(), &found); err != nil {
		t.Fatal(err)
	}
	if len(found.Nodes) != 1 || found.Nodes[0].Children[0].Path != "system/库/笔记.md" {
		t.Fatalf("search = %#v", found)
	}
}

func TestDocsHTTPCreate(t *testing.T) {
	root := t.TempDir()
	t.Setenv(obsidianvault.EnvVaultPath, root)
	h := &Handler{}

	body := `{"path":"新笔记.md","content":"# 新笔记\n"}`
	w := httptest.NewRecorder()
	h.PostDocsFile(w, httptest.NewRequest(http.MethodPost, "/api/docs/files", strings.NewReader(body)))
	if w.Code != http.StatusCreated {
		t.Fatalf("create status = %d body = %s", w.Code, w.Body.String())
	}
	var note obsidianvault.FileContent
	if err := json.Unmarshal(w.Body.Bytes(), &note); err != nil {
		t.Fatal(err)
	}
	if note.Path != "system/新笔记.md" || note.Content != "# 新笔记\n" || note.Revision == "" {
		t.Fatalf("note = %#v", note)
	}

	again := httptest.NewRecorder()
	h.PostDocsFile(again, httptest.NewRequest(http.MethodPost, "/api/docs/files", strings.NewReader(body)))
	if again.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d body = %s", again.Code, again.Body.String())
	}
	var conflict map[string]string
	if err := json.Unmarshal(again.Body.Bytes(), &conflict); err != nil {
		t.Fatal(err)
	}
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
	t.Setenv(obsidianvault.EnvVaultPath, root)
	h := &Handler{}

	w := httptest.NewRecorder()
	h.PostDocsMove(w, httptest.NewRequest(http.MethodPost, "/api/docs/move", strings.NewReader(`{"path":"笔记.md","dest":"归档"}`)))
	if w.Code != http.StatusOK {
		t.Fatalf("move status = %d body = %s", w.Code, w.Body.String())
	}
	var moved obsidianvault.MoveResult
	if err := json.Unmarshal(w.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	if moved.From != "system/笔记.md" || moved.Path != "system/归档/笔记.md" || moved.Type != obsidianvault.TypeFile {
		t.Fatalf("moved = %#v", moved)
	}

	intoSelf := httptest.NewRecorder()
	h.PostDocsMove(intoSelf, httptest.NewRequest(http.MethodPost, "/api/docs/move", strings.NewReader(`{"path":"归档","dest":"归档"}`)))
	if intoSelf.Code != http.StatusBadRequest {
		t.Fatalf("into self status = %d body = %s", intoSelf.Code, intoSelf.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(intoSelf.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["code"] != "docs_invalid_move" {
		t.Fatalf("into self body = %#v", body)
	}
}

func TestDocsHTTPContentEdit(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv(obsidianvault.EnvVaultPath, root)
	h := &Handler{}

	readReq := httptest.NewRequest(http.MethodPost, "/api/docs/files/content", strings.NewReader(`{"path":"note.md"}`))
	readW := httptest.NewRecorder()
	h.PostDocsFileContent(readW, readReq)
	if readW.Code != http.StatusOK {
		t.Fatalf("read status = %d body = %s", readW.Code, readW.Body.String())
	}
	var note obsidianvault.FileContent
	if err := json.Unmarshal(readW.Body.Bytes(), &note); err != nil {
		t.Fatal(err)
	}
	if note.Path != "system/note.md" || note.Content != "hello" || note.Revision == "" {
		t.Fatalf("note = %#v", note)
	}

	body := `{"path":"note.md","base_revision":"` + note.Revision + `","changes":[{"from":5,"insert":"!"}]}`
	editReq := httptest.NewRequest(http.MethodPatch, "/api/docs/files/content", strings.NewReader(body))
	editW := httptest.NewRecorder()
	h.PatchDocsFileContent(editW, editReq)
	if editW.Code != http.StatusOK {
		t.Fatalf("edit status = %d body = %s", editW.Code, editW.Body.String())
	}
	var updated obsidianvault.FileContent
	if err := json.Unmarshal(editW.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Content != "hello!" {
		t.Fatalf("updated = %#v", updated)
	}
}
