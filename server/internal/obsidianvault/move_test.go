package obsidianvault

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestMoveFileIntoDirectory(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "库/笔记.md", "# 笔记\n")
	writeFile(t, root, "归档/占位.md", "x")
	ctx := context.Background()

	got, err := Move(ctx, root, "库/笔记.md", "归档")
	if err != nil {
		t.Fatalf("Move: %v", err)
	}
	if got.From != "库/笔记.md" || got.Path != "归档/笔记.md" || got.Name != "笔记.md" || got.Type != TypeFile {
		t.Fatalf("moved = %#v", got)
	}
	raw, err := os.ReadFile(filepath.Join(root, "归档/笔记.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "# 笔记\n" {
		t.Fatalf("content = %q", raw)
	}
	if _, err := os.Stat(filepath.Join(root, "库/笔记.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source still present: %v", err)
	}
}

func TestMoveDirectoryKeepsChildren(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "项目/计划/Q3.md", "q3")
	writeFile(t, root, "归档/占位.md", "x")

	got, err := Move(context.Background(), root, "项目", "归档")
	if err != nil {
		t.Fatalf("Move: %v", err)
	}
	if got.Path != "归档/项目" || got.Type != TypeDir {
		t.Fatalf("moved = %#v", got)
	}
	raw, err := os.ReadFile(filepath.Join(root, "归档/项目/计划/Q3.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "q3" {
		t.Fatalf("child = %q", raw)
	}
}

func TestMoveToVaultRoot(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "库/笔记.md", "body")

	got, err := Move(context.Background(), root, "库/笔记.md", "")
	if err != nil {
		t.Fatalf("Move: %v", err)
	}
	if got.Path != "笔记.md" {
		t.Fatalf("path = %q", got.Path)
	}
	if _, err := os.Stat(filepath.Join(root, "笔记.md")); err != nil {
		t.Fatal(err)
	}
}

func TestMoveSameDirectoryIsNoop(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "库/笔记.md", "keep")

	got, err := Move(context.Background(), root, "库/笔记.md", "库")
	if err != nil {
		t.Fatalf("Move: %v", err)
	}
	if got.Path != "库/笔记.md" || got.From != "库/笔记.md" {
		t.Fatalf("moved = %#v", got)
	}
	raw, err := os.ReadFile(filepath.Join(root, "库/笔记.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "keep" {
		t.Fatalf("content = %q", raw)
	}
}

func TestMoveRefusesInvalidTargets(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "项目/计划/Q3.md", "q3")
	writeFile(t, root, "项目/计划.md", "plan")
	writeFile(t, root, "归档/计划.md", "taken")
	writeFile(t, root, "忽略.txt", "txt")
	writeFile(t, root, ".hidden/a.md", "hidden")
	ctx := context.Background()

	cases := []struct {
		rel  string
		dest string
		want error
	}{
		{rel: "项目", dest: "项目", want: ErrInvalidMove},
		{rel: "项目", dest: "项目/计划", want: ErrInvalidMove},
		{rel: "项目/计划.md", dest: "归档", want: ErrExists},
		{rel: "忽略.txt", dest: "", want: ErrNotFile},
		{rel: ".hidden/a.md", dest: "", want: ErrInvalidPath},
		{rel: "../escape.md", dest: "", want: ErrInvalidPath},
		{rel: "项目/计划.md", dest: "缺失", want: ErrNotFound},
		{rel: "项目/计划.md", dest: "项目/计划.md", want: ErrNotDir},
		{rel: "缺失.md", dest: "", want: ErrNotFound},
	}
	for _, tc := range cases {
		if _, err := Move(ctx, root, tc.rel, tc.dest); !errors.Is(err, tc.want) {
			t.Errorf("Move(%q, %q) err = %v, want %v", tc.rel, tc.dest, err, tc.want)
		}
	}
	raw, err := os.ReadFile(filepath.Join(root, "项目/计划.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "plan" {
		t.Fatalf("source changed: %q", raw)
	}
}
