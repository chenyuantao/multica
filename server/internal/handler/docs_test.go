package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

func TestDocsHTTPUnconfigured(t *testing.T) {
	t.Setenv(obsidianvault.EnvVaultPath, "")
	req := httptest.NewRequest(http.MethodGet, "/api/docs/tree", nil)
	w := httptest.NewRecorder()
	(&Handler{}).GetDocsTree(w, req)
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

	treeReq := httptest.NewRequest(http.MethodGet, "/api/docs/tree", nil)
	treeW := httptest.NewRecorder()
	h.GetDocsTree(treeW, treeReq)
	if treeW.Code != http.StatusOK {
		t.Fatalf("tree status = %d body = %s", treeW.Code, treeW.Body.String())
	}
	var tree obsidianvault.TreeResult
	if err := json.Unmarshal(treeW.Body.Bytes(), &tree); err != nil {
		t.Fatal(err)
	}
	if len(tree.Nodes) != 1 || tree.Nodes[0].Name != "库" || tree.Nodes[0].Children[0].Name != "笔记.md" {
		t.Fatalf("tree = %#v", tree)
	}

	searchReq := httptest.NewRequest(http.MethodGet, "/api/docs/search?q="+url.QueryEscape("关键词"), nil)
	searchW := httptest.NewRecorder()
	h.SearchDocs(searchW, searchReq)
	if searchW.Code != http.StatusOK {
		t.Fatalf("search status = %d body = %s", searchW.Code, searchW.Body.String())
	}
	var found obsidianvault.SearchResult
	if err := json.Unmarshal(searchW.Body.Bytes(), &found); err != nil {
		t.Fatal(err)
	}
	if len(found.Nodes) != 1 || found.Nodes[0].Children[0].Path != "库/笔记.md" {
		t.Fatalf("search = %#v", found)
	}
}
