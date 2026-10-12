package obsidianvault

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestMkdirCreatesOneDirectory(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "库/已有.md", "x")
	ctx := context.Background()

	got, err := Mkdir(ctx, root, "库/归档")
	if err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	if got.Path != "库/归档" || got.Name != "归档" || got.Type != TypeDir {
		t.Fatalf("created = %#v", got)
	}
	info, err := os.Stat(filepath.Join(root, "库/归档"))
	if err != nil || !info.IsDir() {
		t.Fatalf("dir = %v, err = %v", info, err)
	}

	if _, err := Mkdir(ctx, root, "库/归档"); !errors.Is(err, ErrExists) {
		t.Fatalf("existing err = %v", err)
	}
}

func TestMkdirRefusesInvalidPaths(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "note.md", "x")
	ctx := context.Background()
	cases := map[string]error{
		"":              ErrInvalidPath,
		".":             ErrInvalidPath,
		".hidden":       ErrInvalidPath,
		"../escape":     ErrInvalidPath,
		"missing/child": ErrNotFound,
		"note.md/child": ErrNotDir,
	}
	for rel, want := range cases {
		if _, err := Mkdir(ctx, root, rel); !errors.Is(err, want) {
			t.Errorf("Mkdir(%q) err = %v, want %v", rel, err, want)
		}
	}
}

func TestRenameFileAndDirectory(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "项目/计划.md", "正文")
	ctx := context.Background()

	file, err := Rename(ctx, root, "项目/计划.md", "方案.md")
	if err != nil {
		t.Fatalf("rename file: %v", err)
	}
	if file.From != "项目/计划.md" || file.Path != "项目/方案.md" || file.Type != TypeFile {
		t.Fatalf("file = %#v", file)
	}
	raw, err := os.ReadFile(filepath.Join(root, "项目/方案.md"))
	if err != nil || string(raw) != "正文" {
		t.Fatalf("renamed body = %q, err = %v", raw, err)
	}

	dir, err := Rename(ctx, root, "项目", "归档")
	if err != nil {
		t.Fatalf("rename dir: %v", err)
	}
	if dir.From != "项目" || dir.Path != "归档" || dir.Type != TypeDir {
		t.Fatalf("dir = %#v", dir)
	}
	if _, err := os.Stat(filepath.Join(root, "归档/方案.md")); err != nil {
		t.Fatal(err)
	}

	same, err := Rename(ctx, root, "归档/方案.md", "方案.md")
	if err != nil || same.Path != "归档/方案.md" {
		t.Fatalf("same name = %#v, err = %v", same, err)
	}
}

func TestRenameRefusesInvalidNames(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "项目/计划.md", "正文")
	writeFile(t, root, "项目/已有.md", "x")
	ctx := context.Background()
	cases := map[string]error{
		"笔记.txt":  ErrNotFile,
		"":        ErrInvalidPath,
		"../x.md": ErrInvalidPath,
		".md":     ErrInvalidPath,
		"已有.md":   ErrExists,
	}
	for name, want := range cases {
		if _, err := Rename(ctx, root, "项目/计划.md", name); !errors.Is(err, want) {
			t.Errorf("Rename(%q) err = %v, want %v", name, err, want)
		}
	}
	if _, err := os.ReadFile(filepath.Join(root, "项目/计划.md")); err != nil {
		t.Fatal(err)
	}
}

func TestRemoveFileAndDirectory(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "项目/计划.md", "正文")
	writeFile(t, root, "项目/附件.txt", "附件")
	writeFile(t, root, "留着.md", "留")
	ctx := context.Background()

	if err := Remove(ctx, root, "项目"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "项目")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("dir still present: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "留着.md")); err != nil {
		t.Fatal(err)
	}

	if err := Remove(ctx, root, "留着.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "留着.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("file still present: %v", err)
	}
}

func TestRemoveRefusesRootHiddenAndOutsideSymlink(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "note.txt", "x")
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(outsideFile, link); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	for _, rel := range []string{"", ".", ".hidden/a.md", "../escape.md"} {
		if err := Remove(ctx, root, rel); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("Remove(%q) err = %v", rel, err)
		}
	}
	if err := Remove(ctx, root, "note.txt"); !errors.Is(err, ErrNotFile) {
		t.Fatalf("txt err = %v", err)
	}
	if err := Remove(ctx, root, "link"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(link); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("symlink still present: %v", err)
	}
	raw, err := os.ReadFile(outsideFile)
	if err != nil || string(raw) != "secret" {
		t.Fatalf("symlink target = %q, err = %v", raw, err)
	}
}
