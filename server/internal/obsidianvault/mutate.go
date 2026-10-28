package obsidianvault

import (
	"context"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Entry is a vault path after it is created.
type Entry struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// Mkdir creates one directory. The parent must already exist. An existing
// path is never replaced. An empty path is the vault root and is refused.
func Mkdir(ctx context.Context, root, rel string) (Entry, error) {
	if err := ctx.Err(); err != nil {
		return Entry{}, err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return Entry{}, err
	}
	cleaned, err := cleanRel(rel)
	if err != nil {
		return Entry{}, err
	}
	if cleaned == "" || hasHiddenSegment(cleaned) {
		return Entry{}, ErrInvalidPath
	}
	name := path.Base(cleaned)
	parentRel := path.Dir(cleaned)
	if parentRel == "." {
		parentRel = ""
	}
	parent, _, err := open(root, parentRel)
	if err != nil {
		return Entry{}, err
	}
	info, err := os.Stat(parent)
	if err != nil {
		return Entry{}, ErrNotFound
	}
	if !info.IsDir() {
		return Entry{}, ErrNotDir
	}
	target := filepath.Join(parent, name)
	unlock := lockNote(target)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return Entry{}, err
	}
	if err := os.Mkdir(target, 0o755); err != nil {
		if errors.Is(err, os.ErrExist) {
			return Entry{}, ErrExists
		}
		return Entry{}, err
	}
	return Entry{Path: cleaned, Name: name, Type: TypeDir}, nil
}

// Rename changes an entry's name inside its current directory. A markdown
// file must stay a markdown file. The same name changes nothing.
func Rename(ctx context.Context, root, rel, name string) (MoveResult, error) {
	if err := ctx.Err(); err != nil {
		return MoveResult{}, err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return MoveResult{}, err
	}
	cleaned, abs, err := entryPath(root, rel)
	if err != nil {
		return MoveResult{}, err
	}
	next, err := entryName(name)
	if err != nil {
		return MoveResult{}, err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return MoveResult{}, ErrNotFound
		}
		return MoveResult{}, err
	}
	kind, err := moveKind(path.Base(cleaned), info, abs)
	if err != nil {
		return MoveResult{}, err
	}
	if kind == TypeFile && !isMarkdown(next) {
		return MoveResult{}, ErrNotFile
	}
	current := path.Base(cleaned)
	parentRel := path.Dir(cleaned)
	if parentRel == "." {
		parentRel = ""
	}
	if next == current {
		return MoveResult{From: cleaned, Path: cleaned, Name: current, Type: kind}, nil
	}
	newRel := next
	if parentRel != "" {
		newRel = parentRel + "/" + next
	}
	target := filepath.Join(filepath.Dir(abs), next)
	unlock := lockPair(abs, target)
	defer unlock()
	if _, err := os.Lstat(target); err == nil {
		return MoveResult{}, ErrExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return MoveResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return MoveResult{}, err
	}
	if err := os.Rename(abs, target); err != nil {
		return MoveResult{}, err
	}
	return MoveResult{From: cleaned, Path: newRel, Name: next, Type: kind}, nil
}

// Remove deletes one markdown file, or a directory and everything inside it.
// A symlink is unlinked and its target is left in place. The vault root
// cannot be removed.
func Remove(ctx context.Context, root, rel string) error {
	return remove(ctx, root, rel, "")
}

// RemoveIfRevision checks the revision and deletes under the same lock as Apply.
// This lock does not cover non-cooperating writes outside this process.
func RemoveIfRevision(ctx context.Context, root, rel, expectedRevision string) error {
	if strings.TrimSpace(expectedRevision) == "" {
		return ErrInvalidEdit
	}
	return remove(ctx, root, rel, expectedRevision)
}

func remove(ctx context.Context, root, rel, expectedRevision string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return err
	}
	cleaned, abs, err := entryPath(root, rel)
	if err != nil {
		return err
	}
	parentRel := path.Dir(cleaned)
	if parentRel == "." {
		parentRel = ""
	}
	parent, _, err := open(root, parentRel)
	if err != nil {
		return err
	}
	abs = filepath.Join(parent, path.Base(cleaned))
	unlock := lockNote(abs)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	if expectedRevision != "" {
		if !info.Mode().IsRegular() || !isMarkdown(path.Base(cleaned)) {
			return ErrNotFile
		}
		current, err := loadNote(abs, cleaned)
		if err != nil {
			return err
		}
		if current.Revision != expectedRevision {
			return &ConflictError{ModifiedAt: current.ModifiedAt, Revision: current.Revision}
		}
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return os.Remove(abs)
	}
	if info.IsDir() {
		if _, ok := contained(root, abs); !ok {
			return ErrInvalidPath
		}
		return os.RemoveAll(abs)
	}
	if !isMarkdown(path.Base(cleaned)) {
		return ErrNotFile
	}
	return os.Remove(abs)
}

func entryPath(root, rel string) (cleaned, abs string, err error) {
	cleaned, err = cleanRel(rel)
	if err != nil {
		return "", "", err
	}
	if cleaned == "" || hasHiddenSegment(cleaned) {
		return "", "", ErrInvalidPath
	}
	abs = filepath.Join(root, filepath.FromSlash(cleaned))
	back, err := filepath.Rel(root, abs)
	if err != nil || back == ".." || strings.HasPrefix(back, ".."+string(os.PathSeparator)) {
		return "", "", ErrInvalidPath
	}
	return cleaned, abs, nil
}

func entryName(name string) (string, error) {
	name = strings.TrimSpace(name)
	name = strings.ReplaceAll(name, "\\", "/")
	if name == "" || name == "." || name == ".." || strings.ContainsRune(name, '\x00') || strings.Contains(name, "/") || strings.HasPrefix(name, ".") {
		return "", ErrInvalidPath
	}
	return name, nil
}
