package obsidianvault

import (
	"context"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// ErrInvalidMove means the destination is the source directory or inside it.
var ErrInvalidMove = errors.New("invalid document move")

// MoveResult is a vault entry after it has been placed in a directory.
// From is the path before the move. Path equals From when the entry was
// already in dest.
type MoveResult struct {
	From string `json:"from"`
	Path string `json:"path"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// Move places the markdown file or directory at rel into dest, keeping its
// name. An empty dest is the vault root. The parent directory must already
// exist. A move into the entry's current directory changes nothing.
func Move(ctx context.Context, root, rel, dest string) (MoveResult, error) {
	if err := ctx.Err(); err != nil {
		return MoveResult{}, err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return MoveResult{}, err
	}
	cleaned, err := cleanRel(rel)
	if err != nil {
		return MoveResult{}, err
	}
	if cleaned == "" || hasHiddenSegment(cleaned) {
		return MoveResult{}, ErrInvalidPath
	}
	destClean, err := cleanRel(dest)
	if err != nil {
		return MoveResult{}, err
	}
	if hasHiddenSegment(destClean) {
		return MoveResult{}, ErrInvalidPath
	}

	parentRel := path.Dir(cleaned)
	if parentRel == "." {
		parentRel = ""
	}
	name := path.Base(cleaned)
	parentAbs, _, err := open(root, parentRel)
	if err != nil {
		return MoveResult{}, err
	}
	sourceAbs := filepath.Join(parentAbs, name)
	info, err := os.Lstat(sourceAbs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return MoveResult{}, ErrNotFound
		}
		return MoveResult{}, err
	}
	if _, ok := contained(root, sourceAbs); !ok {
		return MoveResult{}, ErrInvalidPath
	}
	kind, err := moveKind(name, info, sourceAbs)
	if err != nil {
		return MoveResult{}, err
	}
	if kind == TypeDir && (destClean == cleaned || strings.HasPrefix(destClean, cleaned+"/")) {
		return MoveResult{}, ErrInvalidMove
	}

	newRel := name
	if destClean != "" {
		newRel = destClean + "/" + name
	}
	if newRel == cleaned {
		return MoveResult{From: cleaned, Path: cleaned, Name: name, Type: kind}, nil
	}

	destAbs, _, err := open(root, destClean)
	if err != nil {
		return MoveResult{}, err
	}
	destInfo, err := os.Stat(destAbs)
	if err != nil {
		return MoveResult{}, ErrNotFound
	}
	if !destInfo.IsDir() {
		return MoveResult{}, ErrNotDir
	}

	targetAbs := filepath.Join(destAbs, name)
	unlock := lockPair(sourceAbs, targetAbs)
	defer unlock()
	if _, err := os.Lstat(targetAbs); err == nil {
		return MoveResult{}, ErrExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return MoveResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return MoveResult{}, err
	}
	if err := os.Rename(sourceAbs, targetAbs); err != nil {
		return MoveResult{}, err
	}
	return MoveResult{From: cleaned, Path: newRel, Name: name, Type: kind}, nil
}

func moveKind(name string, info os.FileInfo, sourceAbs string) (string, error) {
	if info.Mode()&os.ModeSymlink != 0 {
		followed, err := os.Stat(sourceAbs)
		if err != nil {
			return "", ErrNotFound
		}
		info = followed
	}
	if info.IsDir() {
		return TypeDir, nil
	}
	if !isMarkdown(name) {
		return "", ErrNotFile
	}
	return TypeFile, nil
}

func lockPair(a, b string) func() {
	if a == b {
		return lockNote(a)
	}
	if a > b {
		a, b = b, a
	}
	unlockA := lockNote(a)
	unlockB := lockNote(b)
	return func() {
		unlockB()
		unlockA()
	}
}
