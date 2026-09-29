package obsidianvault

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTreeKeepsMarkdownAndDropsEmptyDirs(t *testing.T) {
	root := writeVault(t)

	tree, err := Tree(context.Background(), root)
	if err != nil {
		t.Fatalf("Tree: %v", err)
	}
	if len(tree.Nodes) != 3 {
		t.Fatalf("top level = %#v", names(tree.Nodes))
	}
	if tree.Nodes[0].Type != TypeDir || tree.Nodes[0].Name != "战略增长知识库" || tree.Nodes[0].ChildCount != 1 {
		t.Fatalf("first node = %#v", tree.Nodes[0])
	}
	growth := tree.Nodes[0].Children
	if len(growth) != 1 || growth[0].Name != "2025业务线规划" || growth[0].ChildCount != 2 {
		t.Fatalf("growth children = %#v", growth)
	}
	note := growth[0].Children[0]
	if note.Type != TypeFile || note.Name != "Q3.md" || note.Path != "战略增长知识库/2025业务线规划/Q3.md" || note.ModifiedAt == nil {
		t.Fatalf("note = %#v", note)
	}
	if tree.Nodes[1].Name != "运营与市场物料库" || tree.Nodes[1].Children[0].Name != "品牌.MD" {
		t.Fatalf("second branch = %#v", tree.Nodes[1])
	}
}

func TestChildrenReturnsOneLevel(t *testing.T) {
	root := writeVault(t)

	got, err := Children(context.Background(), root, "战略增长知识库")
	if err != nil {
		t.Fatalf("Children: %v", err)
	}
	if got.Path != "战略增长知识库" || len(got.Nodes) != 1 {
		t.Fatalf("children = %#v", got)
	}
	dir := got.Nodes[0]
	if dir.Type != TypeDir || dir.Name != "2025业务线规划" || dir.ChildCount != 2 || dir.Children != nil {
		t.Fatalf("next level = %#v", dir)
	}
	raw, err := json.Marshal(dir)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"children"`) {
		t.Fatalf("shallow dir included children: %s", raw)
	}

	rootLevel, err := Children(context.Background(), root, "")
	if err != nil {
		t.Fatalf("root children: %v", err)
	}
	if rootLevel.Path != "" || len(rootLevel.Nodes) != 3 || rootLevel.Nodes[0].Children != nil {
		t.Fatalf("root children = %#v", rootLevel)
	}
}

func TestChildrenRejectsFilesAndEscapes(t *testing.T) {
	root := writeVault(t)
	ctx := context.Background()

	if _, err := Children(ctx, root, "战略增长知识库/2025业务线规划/Q3.md"); err != ErrNotDir {
		t.Fatalf("file children err = %v", err)
	}
	if _, err := Children(ctx, root, "战略增长知识库/../../etc"); err != ErrInvalidPath {
		t.Fatalf("escape err = %v", err)
	}
	if _, err := Children(ctx, root, "missing"); err != ErrNotFound {
		t.Fatalf("missing err = %v", err)
	}
}

func TestHierarchyReturnsAncestors(t *testing.T) {
	root := writeVault(t)

	got, err := Hierarchy(context.Background(), root, `战略增长知识库\2025业务线规划\Q3.md`)
	if err != nil {
		t.Fatalf("Hierarchy: %v", err)
	}
	if got.File.Path != "战略增长知识库/2025业务线规划/Q3.md" || got.File.Type != TypeFile {
		t.Fatalf("file = %#v", got.File)
	}
	if len(got.Ancestors) != 2 {
		t.Fatalf("ancestors = %#v", got.Ancestors)
	}
	if got.Ancestors[0].Path != "战略增长知识库" || got.Ancestors[0].ChildCount != 1 {
		t.Fatalf("ancestor 0 = %#v", got.Ancestors[0])
	}
	if got.Ancestors[1].Path != "战略增长知识库/2025业务线规划" || got.Ancestors[1].ChildCount != 2 {
		t.Fatalf("ancestor 1 = %#v", got.Ancestors[1])
	}

	top, err := Hierarchy(context.Background(), root, "readme.md")
	if err != nil {
		t.Fatalf("root file hierarchy: %v", err)
	}
	if len(top.Ancestors) != 0 || top.File.Name != "readme.md" {
		t.Fatalf("root file = %#v", top)
	}
	if _, err := Hierarchy(context.Background(), root, "战略增长知识库"); err != ErrNotFile {
		t.Fatalf("dir hierarchy err = %v", err)
	}
	if _, err := Hierarchy(context.Background(), root, "运营与市场物料库/忽略.txt"); err != ErrNotFile {
		t.Fatalf("txt hierarchy err = %v", err)
	}
}

func TestSearchReturnsDirectoryTree(t *testing.T) {
	root := writeVault(t)
	ctx := context.Background()

	byContent, err := Search(ctx, root, "归因")
	if err != nil {
		t.Fatalf("content search: %v", err)
	}
	if byContent.Query != "归因" || len(byContent.Nodes) != 1 {
		t.Fatalf("content result = %#v", byContent)
	}
	hit := byContent.Nodes[0]
	if hit.Name != "战略增长知识库" || hit.ChildCount != 1 || len(hit.Children) != 1 {
		t.Fatalf("content root = %#v", hit)
	}
	note := hit.Children[0].Children[0]
	if note.Path != "战略增长知识库/2025业务线规划/Q3.md" || note.Match != MatchContent || !strings.Contains(note.Snippet, "归因") {
		t.Fatalf("content hit = %#v", note)
	}

	writeFile(t, root, "only-title.md", "hello\n")
	byTitle, err := Search(ctx, root, "only-title")
	if err != nil {
		t.Fatalf("title search: %v", err)
	}
	if len(byTitle.Nodes) != 1 || byTitle.Nodes[0].Name != "only-title.md" || byTitle.Nodes[0].Match != MatchTitle || byTitle.Nodes[0].Snippet != "" {
		t.Fatalf("title hit = %#v", byTitle.Nodes)
	}

	byHeading, err := Search(ctx, root, "手册标题")
	if err != nil {
		t.Fatalf("heading search: %v", err)
	}
	if byHeading.Nodes[0].Children[0].Name != "品牌.MD" || byHeading.Nodes[0].Children[0].Match != MatchBoth {
		t.Fatalf("heading hit = %#v", byHeading.Nodes[0].Children[0])
	}

	empty, err := Search(ctx, root, "不存在的词")
	if err != nil {
		t.Fatalf("empty search: %v", err)
	}
	if len(empty.Nodes) != 0 {
		t.Fatalf("empty nodes = %#v", empty.Nodes)
	}
	raw, _ := json.Marshal(empty)
	if !strings.Contains(string(raw), `"nodes":[]`) {
		t.Fatalf("empty nodes encoded as %s", raw)
	}
	if _, err := Search(ctx, root, "  "); err != ErrQueryRequired {
		t.Fatalf("blank query err = %v", err)
	}
}

func TestSearchTruncates(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.md", "alpha")
	writeFile(t, root, "b.md", "alpha")
	orig := maxSearchMatches
	maxSearchMatches = 1
	t.Cleanup(func() { maxSearchMatches = orig })

	got, err := Search(context.Background(), root, "alpha")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if !got.Truncated || len(got.Nodes) != 1 || got.Nodes[0].Name != "a.md" {
		t.Fatalf("truncated = %#v", got)
	}
}

func TestSymlinkOutsideVaultIsHidden(t *testing.T) {
	root := writeVault(t)
	outside := t.TempDir()
	writeFile(t, outside, "secret.md", "secret token")
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlink: %v", err)
	}
	inside := filepath.Join(root, "运营与市场物料库")
	if err := os.Symlink(inside, filepath.Join(root, "别名")); err != nil {
		t.Skipf("symlink: %v", err)
	}

	tree, err := Tree(context.Background(), root)
	if err != nil {
		t.Fatalf("Tree: %v", err)
	}
	for _, node := range tree.Nodes {
		if node.Name == "escape" {
			t.Fatalf("escaped symlink was listed: %#v", node)
		}
	}
	var alias Node
	for _, node := range tree.Nodes {
		if node.Name == "别名" {
			alias = node
		}
	}
	if alias.Name != "别名" || len(alias.Children) != 1 || alias.Children[0].Name != "品牌.MD" {
		t.Fatalf("inside symlink = %#v", alias)
	}

	leaked, err := Search(context.Background(), root, "secret token")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(leaked.Nodes) != 0 {
		t.Fatalf("search leaked symlink target: %#v", leaked.Nodes)
	}
}

func TestVaultRoot(t *testing.T) {
	t.Setenv(EnvVaultPath, "")
	if _, err := VaultRoot(); err != ErrUnconfigured {
		t.Fatalf("empty err = %v", err)
	}
	t.Setenv(EnvVaultPath, filepath.Join(t.TempDir(), "missing"))
	if _, err := VaultRoot(); err != ErrUnavailable {
		t.Fatalf("missing err = %v", err)
	}
	root := t.TempDir()
	t.Setenv(EnvVaultPath, root)
	got, err := VaultRoot()
	if err != nil {
		t.Fatalf("VaultRoot: %v", err)
	}
	if got != root {
		// macOS temp dirs may resolve through a symlink.
		resolved, err := filepath.EvalSymlinks(root)
		if err != nil || got != resolved {
			t.Fatalf("VaultRoot = %s, want %s", got, root)
		}
	}
}

func writeVault(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFile(t, root, "战略增长知识库/2025业务线规划/Q3.md", "# Q3 增长\n\n渠道投放归因说明\n")
	writeFile(t, root, "战略增长知识库/2025业务线规划/预算.md", "---\ntitle: 预算分配\n---\n\nhello\n")
	writeFile(t, root, "战略增长知识库/预算框架.txt", "不要出现")
	writeFile(t, root, "运营与市场物料库/品牌.MD", "# 手册标题\n\n品牌内容\n")
	writeFile(t, root, "运营与市场物料库/忽略.txt", "忽略")
	writeFile(t, root, "空目录/图片.png", "png")
	writeFile(t, root, "空目录/再空一层/说明.txt", "txt")
	writeFile(t, root, ".obsidian/hidden.md", "隐藏笔记")
	writeFile(t, root, "readme.md", "root note")
	return root
}

func writeFile(t *testing.T, root, rel, body string) {
	t.Helper()
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func names(nodes []Node) []string {
	out := make([]string, len(nodes))
	for i, node := range nodes {
		out[i] = node.Type + ":" + node.Name
	}
	return out
}
