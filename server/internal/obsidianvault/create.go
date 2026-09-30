package obsidianvault

import (
	"context"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// ErrExists means a create targeted a path that is already taken.
var ErrExists = errors.New("document already exists")

// Create writes a new markdown note. The parent directory must already exist
// inside the vault; an existing file at the path is never replaced.
func Create(ctx context.Context, root, rel, content string) (FileContent, error) {
	if err := ctx.Err(); err != nil {
		return FileContent{}, err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return FileContent{}, err
	}
	if strings.ContainsRune(content, '\x00') {
		return FileContent{}, ErrInvalidEdit
	}
	if len(content) > maxNoteBytes {
		return FileContent{}, ErrTooLarge
	}
	cleaned, err := cleanRel(rel)
	if err != nil {
		return FileContent{}, err
	}
	name := path.Base(cleaned)
	if cleaned == "" || hasHiddenSegment(cleaned) || !isMarkdown(name) || name == path.Ext(name) {
		return FileContent{}, ErrNotFile
	}
	parentRel := path.Dir(cleaned)
	if parentRel == "." {
		parentRel = ""
	}
	parent, _, err := open(root, parentRel)
	if err != nil {
		return FileContent{}, err
	}
	info, err := os.Stat(parent)
	if err != nil {
		return FileContent{}, ErrNotFound
	}
	if !info.IsDir() {
		return FileContent{}, ErrNotDir
	}
	target := filepath.Join(parent, name)
	unlock := lockNote(target)
	defer unlock()
	f, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return FileContent{}, ErrExists
		}
		return FileContent{}, err
	}
	if _, err := f.WriteString(content); err != nil {
		_ = f.Close()
		_ = os.Remove(target)
		return FileContent{}, err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(target)
		return FileContent{}, err
	}
	return loadNote(target, cleaned)
}
