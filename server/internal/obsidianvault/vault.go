// Package obsidianvault reads an Obsidian vault from disk for the docs APIs.
//
// The vault root comes from OBSIDIAN_VAULT_PATH. Listings keep markdown files
// and directories that still contain markdown after that filter. Hidden
// entries (names starting with "."), every other file type, and directories
// that become empty are omitted. Paths in responses use forward slashes and
// stay inside the vault, including through symlinks.
package obsidianvault

import (
	"context"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	// EnvVaultPath is the absolute path of the Obsidian vault.
	EnvVaultPath = "OBSIDIAN_VAULT_PATH"

	TypeDir  = "dir"
	TypeFile = "file"

	MatchTitle   = "title"
	MatchContent = "content"
	MatchBoth    = "both"

	maxDepth           = 64
	maxSearchQueryRune = 200
	maxSearchFileBytes = 1 << 20
	snippetRadius      = 48
)

// maxSearchMatches caps how many notes a search response includes.
var maxSearchMatches = 200

var (
	// ErrUnconfigured means OBSIDIAN_VAULT_PATH is empty.
	ErrUnconfigured = errors.New("obsidian vault is not configured")
	// ErrUnavailable means the configured path is missing or not a directory.
	ErrUnavailable = errors.New("obsidian vault is unavailable")
	// ErrInvalidPath means the requested path escapes the vault or is malformed.
	ErrInvalidPath = errors.New("invalid document path")
	// ErrNotFound means the path is not inside the vault.
	ErrNotFound = errors.New("document not found")
	// ErrNotFile means a file operation was given a directory or a non-markdown path.
	ErrNotFile = errors.New("path is not a markdown file")
	// ErrNotDir means a directory operation was given a file.
	ErrNotDir = errors.New("path is not a directory")
	// ErrQueryRequired means the search query is empty.
	ErrQueryRequired = errors.New("search query is required")
	// ErrQueryTooLong means the search query exceeds maxSearchQueryRune.
	ErrQueryTooLong = errors.New("search query is too long")
)

// Node is one visible vault entry. Directories carry ChildCount of their
// direct visible children. Children is populated for a full tree or a search
// result and left empty when only the next level was requested.
type Node struct {
	Name       string  `json:"name"`
	Path       string  `json:"path"`
	Type       string  `json:"type"`
	ChildCount int     `json:"child_count,omitempty"`
	ModifiedAt *string `json:"modified_at,omitempty"`
	Children   []Node  `json:"children,omitempty"`
	Match      string  `json:"match,omitempty"`
	Snippet    string  `json:"snippet,omitempty"`
}

// TreeResult is the fully expanded vault, with empty directories removed.
type TreeResult struct {
	Nodes []Node `json:"nodes"`
}

// ChildrenResult is one directory level. Directory nodes omit Children so the
// client can tell they have not been loaded yet; ChildCount is still set.
type ChildrenResult struct {
	Path  string `json:"path"`
	Nodes []Node `json:"nodes"`
}

// HierarchyResult is a markdown file and its parent directories from the vault
// root down to the file's parent.
type HierarchyResult struct {
	File      Node   `json:"file"`
	Ancestors []Node `json:"ancestors"`
}

// SearchResult is a directory tree containing only keyword matches.
type SearchResult struct {
	Query     string `json:"query"`
	Nodes     []Node `json:"nodes"`
	Truncated bool   `json:"truncated,omitempty"`
}

// VaultRoot resolves OBSIDIAN_VAULT_PATH to a real directory.
func VaultRoot() (string, error) {
	raw := strings.TrimSpace(os.Getenv(EnvVaultPath))
	if raw == "" {
		return "", ErrUnconfigured
	}
	return resolveRoot(raw)
}

func resolveRoot(root string) (string, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", ErrUnavailable
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", ErrUnavailable
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		return "", ErrUnavailable
	}
	return resolved, nil
}

// Tree returns the whole visible vault.
func Tree(ctx context.Context, root string) (TreeResult, error) {
	root, err := resolveRoot(root)
	if err != nil {
		return TreeResult{}, err
	}
	nodes, err := list(ctx, root, root, "", map[string]struct{}{}, true)
	if err != nil {
		return TreeResult{}, err
	}
	return TreeResult{Nodes: nonNil(nodes)}, nil
}

// Children returns the next visible level under rel. An empty rel is the vault root.
func Children(ctx context.Context, root, rel string) (ChildrenResult, error) {
	root, err := resolveRoot(root)
	if err != nil {
		return ChildrenResult{}, err
	}
	resolved, cleaned, err := open(root, rel)
	if err != nil {
		return ChildrenResult{}, err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return ChildrenResult{}, ErrNotFound
	}
	if !info.IsDir() {
		return ChildrenResult{}, ErrNotDir
	}
	nodes, err := list(ctx, root, resolved, cleaned, map[string]struct{}{}, false)
	if err != nil {
		return ChildrenResult{}, err
	}
	return ChildrenResult{Path: cleaned, Nodes: nonNil(nodes)}, nil
}

// Hierarchy returns the ancestor directories of one markdown file.
func Hierarchy(ctx context.Context, root, rel string) (HierarchyResult, error) {
	root, err := resolveRoot(root)
	if err != nil {
		return HierarchyResult{}, err
	}
	resolved, cleaned, err := open(root, rel)
	if err != nil {
		return HierarchyResult{}, err
	}
	if cleaned == "" || !isMarkdown(path.Base(cleaned)) {
		return HierarchyResult{}, ErrNotFile
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return HierarchyResult{}, ErrNotFound
	}
	if info.IsDir() || !isMarkdown(info.Name()) {
		return HierarchyResult{}, ErrNotFile
	}
	file := fileNode(path.Base(cleaned), cleaned, info)
	ancestors := make([]Node, 0)
	parts := strings.Split(cleaned, "/")
	acc := ""
	for _, part := range parts[:len(parts)-1] {
		if acc == "" {
			acc = part
		} else {
			acc += "/" + part
		}
		dirResolved, _, err := open(root, acc)
		if err != nil {
			return HierarchyResult{}, err
		}
		kids, err := list(ctx, root, dirResolved, acc, map[string]struct{}{}, false)
		if err != nil {
			return HierarchyResult{}, err
		}
		ancestors = append(ancestors, Node{
			Name:       part,
			Path:       acc,
			Type:       TypeDir,
			ChildCount: len(kids),
		})
	}
	return HierarchyResult{File: file, Ancestors: ancestors}, nil
}

// Search matches the query against each note's title and body, then returns
// the hits nested under their parent directories. Title covers the filename
// stem, a YAML frontmatter title, and the first ATX heading.
func Search(ctx context.Context, root, query string) (SearchResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return SearchResult{}, ErrQueryRequired
	}
	if utf8.RuneCountInString(q) > maxSearchQueryRune {
		return SearchResult{}, ErrQueryTooLong
	}
	root, err := resolveRoot(root)
	if err != nil {
		return SearchResult{}, err
	}
	matches := make([]Node, 0)
	truncated := false
	err = walkFiles(ctx, root, root, "", map[string]struct{}{}, func(node Node, body string) error {
		titleHit := containsFold(titleText(node.Name, body), q)
		contentHit := containsFold(body, q)
		if !titleHit && !contentHit {
			return nil
		}
		if len(matches) >= maxSearchMatches {
			truncated = true
			return errStopWalk
		}
		switch {
		case titleHit && contentHit:
			node.Match = MatchBoth
		case titleHit:
			node.Match = MatchTitle
		default:
			node.Match = MatchContent
		}
		if contentHit {
			node.Snippet = snippetAround(body, q)
		}
		matches = append(matches, node)
		return nil
	})
	if err != nil && !errors.Is(err, errStopWalk) {
		return SearchResult{}, err
	}
	return SearchResult{
		Query:     q,
		Nodes:     nonNil(treeFromMatches(matches)),
		Truncated: truncated,
	}, nil
}

var errStopWalk = errors.New("stop walk")

func list(ctx context.Context, root, dirAbs, rel string, stack map[string]struct{}, attach bool) ([]Node, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(stack) > maxDepth {
		return nil, nil
	}
	if _, loop := stack[dirAbs]; loop {
		return nil, nil
	}
	stack[dirAbs] = struct{}{}
	defer delete(stack, dirAbs)

	entries, err := os.ReadDir(dirAbs)
	if err != nil {
		if rel == "" {
			return nil, err
		}
		return nil, nil
	}
	nodes := make([]Node, 0)
	for _, entry := range entries {
		name := entry.Name()
		if name == "" || strings.HasPrefix(name, ".") || strings.ContainsRune(name, '\x00') {
			continue
		}
		childAbs := filepath.Join(dirAbs, name)
		resolved, ok := contained(root, childAbs)
		if !ok {
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil {
			continue
		}
		childRel := name
		if rel != "" {
			childRel = rel + "/" + name
		}
		if info.IsDir() {
			kids, err := list(ctx, root, resolved, childRel, stack, attach)
			if err != nil {
				return nil, err
			}
			if len(kids) == 0 {
				continue
			}
			node := Node{
				Name:       name,
				Path:       childRel,
				Type:       TypeDir,
				ChildCount: len(kids),
			}
			if attach {
				node.Children = kids
			}
			nodes = append(nodes, node)
			continue
		}
		if !isMarkdown(name) {
			continue
		}
		nodes = append(nodes, fileNode(name, childRel, info))
	}
	sortNodes(nodes)
	return nodes, nil
}

func walkFiles(ctx context.Context, root, dirAbs, rel string, stack map[string]struct{}, visit func(Node, string) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(stack) > maxDepth {
		return nil
	}
	if _, loop := stack[dirAbs]; loop {
		return nil
	}
	stack[dirAbs] = struct{}{}
	defer delete(stack, dirAbs)

	entries, err := os.ReadDir(dirAbs)
	if err != nil {
		if rel == "" {
			return err
		}
		return nil
	}
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})
	for _, entry := range entries {
		name := entry.Name()
		if name == "" || strings.HasPrefix(name, ".") || strings.ContainsRune(name, '\x00') {
			continue
		}
		childAbs := filepath.Join(dirAbs, name)
		resolved, ok := contained(root, childAbs)
		if !ok {
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil {
			continue
		}
		childRel := name
		if rel != "" {
			childRel = rel + "/" + name
		}
		if info.IsDir() {
			if err := walkFiles(ctx, root, resolved, childRel, stack, visit); err != nil {
				return err
			}
			continue
		}
		if !isMarkdown(name) {
			continue
		}
		body, err := readLimited(resolved, maxSearchFileBytes)
		if err != nil {
			continue
		}
		if err := visit(fileNode(name, childRel, info), body); err != nil {
			return err
		}
	}
	return nil
}

func treeFromMatches(files []Node) []Node {
	root := &branch{children: map[string]*branch{}}
	for _, file := range files {
		cur := root
		acc := ""
		parts := strings.Split(file.Path, "/")
		for i, part := range parts {
			if acc == "" {
				acc = part
			} else {
				acc += "/" + part
			}
			next, ok := cur.children[part]
			if !ok {
				next = &branch{name: part, path: acc, children: map[string]*branch{}}
				cur.children[part] = next
			}
			if i == len(parts)-1 {
				copied := file
				next.file = &copied
			}
			cur = next
		}
	}
	return root.nodes()
}

type branch struct {
	name     string
	path     string
	file     *Node
	children map[string]*branch
}

func (b *branch) nodes() []Node {
	if b == nil || len(b.children) == 0 {
		return []Node{}
	}
	out := make([]Node, 0, len(b.children))
	for _, child := range b.children {
		if child.file != nil {
			out = append(out, *child.file)
			continue
		}
		kids := child.nodes()
		out = append(out, Node{
			Name:       child.name,
			Path:       child.path,
			Type:       TypeDir,
			ChildCount: len(kids),
			Children:   kids,
		})
	}
	sortNodes(out)
	return out
}

func fileNode(name, rel string, info os.FileInfo) Node {
	modified := info.ModTime().UTC().Format("2006-01-02T15:04:05Z")
	return Node{
		Name:       name,
		Path:       rel,
		Type:       TypeFile,
		ModifiedAt: &modified,
	}
}

func open(root, rel string) (resolved, cleaned string, err error) {
	cleaned, err = cleanRel(rel)
	if err != nil {
		return "", "", err
	}
	joined := root
	if cleaned != "" {
		joined = filepath.Join(root, filepath.FromSlash(cleaned))
	}
	resolved, ok := contained(root, joined)
	if ok {
		return resolved, cleaned, nil
	}
	if _, statErr := os.Lstat(joined); errors.Is(statErr, os.ErrNotExist) {
		return "", "", ErrNotFound
	}
	return "", "", ErrInvalidPath
}

func cleanRel(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	rel = strings.ReplaceAll(rel, "\\", "/")
	rel = strings.Trim(rel, "/")
	if strings.ContainsRune(rel, '\x00') {
		return "", ErrInvalidPath
	}
	if rel == "" {
		return "", nil
	}
	if filepath.IsAbs(rel) {
		return "", ErrInvalidPath
	}
	cleaned := path.Clean(rel)
	if cleaned == "." {
		return "", nil
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", ErrInvalidPath
	}
	return cleaned, nil
}

func contained(root, candidate string) (string, bool) {
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil {
		return "", false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", false
	}
	return resolved, true
}

func isMarkdown(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".md")
}

func sortNodes(nodes []Node) {
	sort.SliceStable(nodes, func(i, j int) bool {
		iDir := nodes[i].Type == TypeDir
		jDir := nodes[j].Type == TypeDir
		if iDir != jDir {
			return iDir
		}
		return strings.ToLower(nodes[i].Name) < strings.ToLower(nodes[j].Name)
	})
}

func nonNil(nodes []Node) []Node {
	if nodes == nil {
		return []Node{}
	}
	return nodes
}

func readLimited(path string, limit int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf, err := io.ReadAll(io.LimitReader(f, limit))
	if err != nil {
		return "", err
	}
	if len(buf) >= 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF {
		buf = buf[3:]
	}
	for len(buf) > 0 && !utf8.Valid(buf) {
		buf = buf[:len(buf)-1]
	}
	return string(buf), nil
}

func titleText(filename, body string) string {
	stem := strings.TrimSuffix(filename, filepath.Ext(filename))
	parts := []string{stem}
	rest := body
	if fm, after, ok := splitFrontmatter(body); ok {
		if title := frontmatterTitle(fm); title != "" {
			parts = append(parts, title)
		}
		rest = after
	}
	if heading := firstHeading(rest); heading != "" {
		parts = append(parts, heading)
	}
	return strings.Join(parts, "\n")
}

func splitFrontmatter(s string) (fm, rest string, ok bool) {
	if !(strings.HasPrefix(s, "---\n") || strings.HasPrefix(s, "---\r\n")) {
		return "", s, false
	}
	lineEnd := "\n"
	if strings.HasPrefix(s, "---\r\n") {
		lineEnd = "\r\n"
	}
	body := s[len("---")+len(lineEnd):]
	closing := lineEnd + "---" + lineEnd
	idx := strings.Index(body, closing)
	if idx < 0 {
		// A frontmatter block that ends the file still counts.
		closing = lineEnd + "---"
		idx = strings.Index(body, closing)
		if idx < 0 || idx+len(closing) != len(body) {
			return "", s, false
		}
	}
	return body[:idx], body[idx+len(closing):], true
}

func frontmatterTitle(fm string) string {
	for _, line := range strings.Split(fm, "\n") {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if len(line) < len("title:") {
			continue
		}
		if !strings.EqualFold(line[:len("title:")], "title:") {
			continue
		}
		value := strings.TrimSpace(line[len("title:"):])
		value = strings.Trim(value, `"'`)
		return value
	}
	return ""
}

func firstHeading(s string) string {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if !strings.HasPrefix(line, "#") {
			continue
		}
		level := 0
		for level < len(line) && line[level] == '#' {
			level++
		}
		if level == 0 || level > 6 || level == len(line) || line[level] != ' ' {
			continue
		}
		heading := strings.TrimSpace(line[level:])
		heading = strings.TrimSpace(strings.TrimRight(heading, "#"))
		if heading != "" {
			return heading
		}
	}
	return ""
}

func containsFold(haystack, needle string) bool {
	return strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}

func snippetAround(body, query string) string {
	lowerBody := strings.ToLower(body)
	lowerQuery := strings.ToLower(query)
	byteAt := strings.Index(lowerBody, lowerQuery)
	if byteAt < 0 {
		return ""
	}
	runeAt := 0
	queryRunes := utf8.RuneCountInString(query)
	if len(lowerBody) == len(body) {
		runeAt = utf8.RuneCountInString(body[:byteAt])
	} else {
		runeAt = indexFoldRunes(body, query)
		if runeAt < 0 {
			return ""
		}
	}
	runes := []rune(body)
	if runeAt > len(runes) {
		return ""
	}
	start := runeAt - snippetRadius
	if start < 0 {
		start = 0
	}
	end := runeAt + queryRunes + snippetRadius
	if end > len(runes) {
		end = len(runes)
	}
	text := strings.Join(strings.Fields(string(runes[start:end])), " ")
	if start > 0 {
		text = "…" + text
	}
	if end < len(runes) {
		text += "…"
	}
	return text
}

func indexFoldRunes(haystack, needle string) int {
	h := []rune(haystack)
	n := []rune(needle)
	if len(n) == 0 || len(n) > len(h) {
		return -1
	}
	for i := 0; i+len(n) <= len(h); i++ {
		if strings.EqualFold(string(h[i:i+len(n)]), needle) {
			return i
		}
	}
	return -1
}
