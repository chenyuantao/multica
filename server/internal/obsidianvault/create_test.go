package obsidianvault

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCreateWritesNewNote(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "库/已有.md", "x")
	ctx := context.Background()

	got, err := Create(ctx, root, "库/新笔记.md", "# 新笔记\n")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if got.Path != "库/新笔记.md" || got.Name != "新笔记.md" || got.Content != "# 新笔记\n" || got.Revision == "" {
		t.Fatalf("created = %#v", got)
	}
	raw, err := os.ReadFile(filepath.Join(root, "库/新笔记.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "# 新笔记\n" {
		t.Fatalf("disk = %q", raw)
	}
}

func TestCreateRefusesExistingAndInvalidPaths(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "note.md", "keep")
	ctx := context.Background()

	if _, err := Create(ctx, root, "note.md", "replaced"); !errors.Is(err, ErrExists) {
		t.Fatalf("existing err = %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "note.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "keep" {
		t.Fatalf("existing note changed: %q", raw)
	}

	cases := map[string]error{
		"note.txt":         ErrNotFile,
		".hidden/a.md":     ErrNotFile,
		".md":              ErrNotFile,
		"../escape.md":     ErrInvalidPath,
		"missing/note.md":  ErrNotFound,
		"note.md/child.md": ErrNotDir,
	}
	for rel, want := range cases {
		if _, err := Create(ctx, root, rel, ""); !errors.Is(err, want) {
			t.Errorf("Create(%q) err = %v, want %v", rel, err, want)
		}
	}
}
