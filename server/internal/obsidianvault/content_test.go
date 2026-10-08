package obsidianvault

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadAndApplyReplacesWholeFile(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "库/笔记.md", "你好世界\n")
	ctx := context.Background()

	got, err := Read(ctx, root, "库/笔记.md")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.Content != "你好世界\n" || got.Name != "笔记.md" || got.Revision == "" {
		t.Fatalf("content = %#v", got)
	}

	end := 3
	updated, err := Apply(ctx, root, EditRequest{
		Path:         "库/笔记.md",
		BaseRevision: got.Revision,
		Changes: []EditChange{
			{From: 0, Insert: "《"},
			{From: 2, To: &end, Insert: "啊"},
		},
	})
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if updated.Content != "《你好啊界\n" {
		t.Fatalf("updated = %q", updated.Content)
	}
	if updated.Revision == got.Revision {
		t.Fatal("revision did not change")
	}
	raw, err := os.ReadFile(filepath.Join(root, "库/笔记.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != updated.Content {
		t.Fatalf("disk = %q", raw)
	}
	entries, err := os.ReadDir(filepath.Join(root, "库"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".obsidian-write-") {
			t.Fatalf("temp file left behind: %s", entry.Name())
		}
	}
}

func TestApplyConflictLeavesFileUntouched(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "note.md", "alpha")
	ctx := context.Background()
	got, err := Read(ctx, root, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("beta"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = Apply(ctx, root, EditRequest{
		Path:         "note.md",
		BaseRevision: got.Revision,
		Changes:      []EditChange{{From: 0, Insert: "x"}},
	})
	var conflict *ConflictError
	if !errors.As(err, &conflict) || conflict.Revision == got.Revision {
		t.Fatalf("conflict = %#v err = %v", conflict, err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "note.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "beta" {
		t.Fatalf("disk = %q", raw)
	}
}

func TestApplyMergesUsingBaseContent(t *testing.T) {
	root := t.TempDir()
	base := "1\n2\n3\n4\n5\n6\n7\n"
	writeFile(t, root, "note.md", "1\n2\n3\n4\n5\nY\n7\n")
	ctx := context.Background()
	current, err := Read(ctx, root, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	end := 5
	updated, err := Apply(ctx, root, EditRequest{
		Path:         "note.md",
		BaseRevision: contentRevision([]byte(base)),
		BaseContent:  &base,
		Resolve:      "merge",
		Changes:      []EditChange{{From: 4, To: &end, Insert: "X"}},
	})
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if updated.Content != "1\n2\nX\n4\n5\nY\n7\n" {
		t.Fatalf("merged = %q", updated.Content)
	}
	if current.Revision == updated.Revision {
		t.Fatal("expected a new revision")
	}
}

func TestApplyMergeConflictDoesNotWrite(t *testing.T) {
	root := t.TempDir()
	base := "alpha"
	writeFile(t, root, "note.md", "beta")
	ctx := context.Background()
	_, err := Apply(ctx, root, EditRequest{
		Path:         "note.md",
		BaseRevision: contentRevision([]byte(base)),
		BaseContent:  &base,
		Resolve:      "merge",
		Changes:      []EditChange{{From: 0, To: intPtr(5), Insert: "ours"}},
	})
	var conflict *MergeConflictError
	if !errors.As(err, &conflict) || !strings.Contains(conflict.Content, "<<<<<<<") {
		t.Fatalf("conflict = %#v err = %v", conflict, err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "note.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "beta" {
		t.Fatalf("disk = %q", raw)
	}
}

func TestMergeWithoutBaseContentConflicts(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "note.md", "beta")
	ctx := context.Background()
	stale := contentRevision([]byte("alpha"))
	for name, req := range map[string]EditRequest{
		"range":     {Path: "note.md", BaseRevision: stale, Resolve: "merge", Changes: []EditChange{{From: 0, To: intPtr(5), Insert: "ours"}}},
		"overwrite": {Path: "note.md", Op: "overwrite", BaseRevision: stale, Resolve: "merge", Content: "ours"},
	} {
		_, err := Apply(ctx, root, req)
		var conflict *ConflictError
		if !errors.As(err, &conflict) || conflict.Reason != "base version not found" {
			t.Fatalf("%s: err = %v", name, err)
		}
	}
	raw, err := os.ReadFile(filepath.Join(root, "note.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "beta" {
		t.Fatalf("disk = %q", raw)
	}
}

func intPtr(n int) *int { return &n }

func TestApplyOverwriteAppendPrepend(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "note.md", "---\ntitle: 标题\n---\n正文")
	ctx := context.Background()
	got, err := Read(ctx, root, "note.md")
	if err != nil {
		t.Fatal(err)
	}

	prepended, err := Apply(ctx, root, EditRequest{Path: "note.md", Op: "prepend", Content: "引言"})
	if err != nil {
		t.Fatalf("prepend: %v", err)
	}
	if prepended.Content != "---\ntitle: 标题\n---\n引言\n正文" {
		t.Fatalf("prepend = %q", prepended.Content)
	}

	appended, err := Apply(ctx, root, EditRequest{Path: "note.md", Op: "append", Content: "结尾", Inline: true})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if appended.Content != "---\ntitle: 标题\n---\n引言\n正文结尾" {
		t.Fatalf("append = %q", appended.Content)
	}

	replaced, err := Apply(ctx, root, EditRequest{
		Path:         "note.md",
		Op:           "overwrite",
		Content:      "新全文\n",
		BaseRevision: appended.Revision,
	})
	if err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	if replaced.Content != "新全文\n" {
		t.Fatalf("overwrite = %q", replaced.Content)
	}

	_, err = Apply(ctx, root, EditRequest{
		Path:         "note.md",
		Op:           "overwrite",
		Content:      "别的",
		BaseRevision: got.Revision,
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale overwrite err = %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "note.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "新全文\n" {
		t.Fatalf("disk = %q", raw)
	}
}

func TestApplyRejectsOverlapAndHidden(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "note.md", "abcdef")
	writeFile(t, root, ".obsidian/secret.md", "hidden")
	ctx := context.Background()
	got, err := Read(ctx, root, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	to3 := 3
	to4 := 4
	_, err = Apply(ctx, root, EditRequest{
		Path:         "note.md",
		BaseRevision: got.Revision,
		Changes: []EditChange{
			{From: 0, To: &to3, Insert: "X"},
			{From: 2, To: &to4, Insert: "Y"},
		},
	})
	if err != ErrInvalidEdit {
		t.Fatalf("overlap err = %v", err)
	}
	raw, _ := os.ReadFile(filepath.Join(root, "note.md"))
	if string(raw) != "abcdef" {
		t.Fatalf("disk = %q", raw)
	}
	if _, err := Read(ctx, root, ".obsidian/secret.md"); err != ErrNotFile {
		t.Fatalf("hidden read err = %v", err)
	}
	if _, err := Apply(ctx, root, EditRequest{
		Path:         "note.txt",
		BaseRevision: got.Revision,
		Changes:      []EditChange{{From: 0, Insert: "a"}},
	}); err != ErrNotFile {
		t.Fatalf("txt edit err = %v", err)
	}
}
