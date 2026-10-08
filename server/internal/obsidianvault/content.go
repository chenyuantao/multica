package obsidianvault

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"
)

const maxNoteBytes = 4 << 20

const maxEditChanges = 500

var (
	// ErrTooLarge means the note exceeds maxNoteBytes.
	ErrTooLarge = errors.New("document is too large")
	// ErrNotUTF8 means the note is not valid UTF-8.
	ErrNotUTF8 = errors.New("document is not utf-8")
	// ErrInvalidEdit means the incremental edit is malformed or overlaps.
	ErrInvalidEdit = errors.New("invalid document edit")
	// ErrConflict means the note changed after the client read it.
	ErrConflict = errors.New("document changed since it was loaded")
)

// FileContent is one markdown note. Revision is the SHA-256 of the exact
// bytes on disk; edits must send it back so a concurrent write is refused.
type FileContent struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	Content    string `json:"content"`
	ModifiedAt string `json:"modified_at"`
	Revision   string `json:"revision"`
}

// EditChange is one range edit against the note as it was read.
// From and To are Unicode code point offsets into that original text.
// To is exclusive. When To is omitted it defaults to From, which inserts.
type EditChange struct {
	From   int    `json:"from"`
	To     *int   `json:"to,omitempty"`
	Insert string `json:"insert"`
}

// EditRequest writes a note. Op selects the write:
//   - empty, with Changes: range edits against the read text
//   - overwrite: replace the whole note with Content
//   - append: add Content at the end
//   - prepend: insert Content after YAML frontmatter, or at the start when
//     there is none
//
// Append and prepend follow the Obsidian CLI: they run on the latest text.
// Inline glues Content on without a separating newline. Overwrite and range
// edits send BaseRevision; Resolve "merge" keeps them when the file changed,
// which needs BaseContent, the text BaseRevision was read from.
type EditRequest struct {
	Path         string       `json:"path"`
	Op           string       `json:"op,omitempty"`
	Content      string       `json:"content,omitempty"`
	Inline       bool         `json:"inline,omitempty"`
	BaseRevision string       `json:"base_revision"`
	BaseContent  *string      `json:"base_content,omitempty"`
	Resolve      string       `json:"resolve,omitempty"`
	Changes      []EditChange `json:"changes"`
}

// ConflictError is returned when base_revision does not match the file.
type ConflictError struct {
	ModifiedAt string
	Revision   string
	Reason     string
}

// MergeConflictError is a three-way merge that still overlaps.
// Content contains conflict markers and was not written.
type MergeConflictError struct {
	Content  string
	Revision string
}

func (e *MergeConflictError) Error() string { return "document changes overlap" }

func (e *ConflictError) Error() string { return ErrConflict.Error() }

func (e *ConflictError) Unwrap() error { return ErrConflict }

// Read returns the full text of one markdown note.
func Read(ctx context.Context, root, rel string) (FileContent, error) {
	if err := ctx.Err(); err != nil {
		return FileContent{}, err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return FileContent{}, err
	}
	return readNote(root, rel)
}

// Apply edits a note the way Obsidian's vault.process does: read the full
// text, apply the changes to that text, and write the complete result back.
// The disk write replaces the whole file via a temporary file in the same
// directory. Changes are offsets into the original text, not a byte patch.
func Apply(ctx context.Context, root string, req EditRequest) (FileContent, error) {
	if err := ctx.Err(); err != nil {
		return FileContent{}, err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return FileContent{}, err
	}
	op := strings.TrimSpace(req.Op)
	if op == "append" || op == "prepend" || op == "overwrite" {
		return applyInstruction(ctx, root, op, req)
	}
	if op != "" || strings.TrimSpace(req.BaseRevision) == "" || len(req.Changes) == 0 || len(req.Changes) > maxEditChanges {
		return FileContent{}, ErrInvalidEdit
	}
	resolved, cleaned, err := openNote(root, req.Path)
	if err != nil {
		return FileContent{}, err
	}
	unlock := lockNote(resolved)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return FileContent{}, err
	}

	current, err := loadNote(resolved, cleaned)
	if err != nil {
		return FileContent{}, err
	}
	base := ""
	haveBase := req.BaseContent != nil
	if haveBase {
		base = *req.BaseContent
	}
	updated, err := composeEdit(ctx, current, req, base, haveBase)
	if err != nil {
		return FileContent{}, err
	}
	if updated == current.Content {
		return current, nil
	}
	next := []byte(updated)
	if len(next) > maxNoteBytes {
		return FileContent{}, ErrTooLarge
	}
	if err := writeFull(resolved, next); err != nil {
		return FileContent{}, err
	}
	return loadNote(resolved, cleaned)
}

func readNote(root, rel string) (FileContent, error) {
	resolved, cleaned, err := openNote(root, rel)
	if err != nil {
		return FileContent{}, err
	}
	return loadNote(resolved, cleaned)
}

func openNote(root, rel string) (resolved, cleaned string, err error) {
	cleaned, err = cleanRel(rel)
	if err != nil {
		return "", "", err
	}
	if cleaned == "" || hasHiddenSegment(cleaned) || !isMarkdown(path.Base(cleaned)) {
		return "", "", ErrNotFile
	}
	resolved, cleaned, err = open(root, cleaned)
	if err != nil {
		return "", "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", "", ErrNotFound
	}
	if info.IsDir() || !isMarkdown(info.Name()) {
		return "", "", ErrNotFile
	}
	return resolved, cleaned, nil
}

func loadNote(resolved, cleaned string) (FileContent, error) {
	data, err := readExact(resolved, maxNoteBytes)
	if err != nil {
		return FileContent{}, err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return FileContent{}, ErrNotFound
	}
	return FileContent{
		Path:       cleaned,
		Name:       path.Base(cleaned),
		Content:    string(data),
		ModifiedAt: info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
		Revision:   contentRevision(data),
	}, nil
}

func contentRevision(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func applyChanges(content string, changes []EditChange) (string, error) {
	runes := []rune(content)
	spans := make([]editSpan, len(changes))
	for i, change := range changes {
		if strings.ContainsRune(change.Insert, '\x00') {
			return "", ErrInvalidEdit
		}
		to := change.From
		if change.To != nil {
			to = *change.To
		}
		if change.From < 0 || to < change.From || to > len(runes) {
			return "", ErrInvalidEdit
		}
		spans[i] = editSpan{from: change.From, to: to, insert: change.Insert, index: i}
	}
	for i := range spans {
		for j := i + 1; j < len(spans); j++ {
			if spans[i].from < spans[j].to && spans[j].from < spans[i].to {
				return "", ErrInvalidEdit
			}
		}
	}
	sort.SliceStable(spans, func(i, j int) bool {
		if spans[i].from != spans[j].from {
			return spans[i].from > spans[j].from
		}
		return spans[i].index > spans[j].index
	})
	buf := runes
	for _, span := range spans {
		insert := []rune(span.insert)
		next := make([]rune, 0, len(buf)-(span.to-span.from)+len(insert))
		next = append(next, buf[:span.from]...)
		next = append(next, insert...)
		next = append(next, buf[span.to:]...)
		buf = next
	}
	return string(buf), nil
}

type editSpan struct {
	from   int
	to     int
	insert string
	index  int
}

func readExact(path string, limit int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	defer f.Close()
	buf, err := io.ReadAll(io.LimitReader(f, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(buf) > limit {
		return nil, ErrTooLarge
	}
	if !utf8.Valid(buf) {
		return nil, ErrNotUTF8
	}
	return buf, nil
}

func writeFull(path string, data []byte) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".obsidian-write-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmp)
		}
	}()
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, info.Mode().Perm()); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func hasHiddenSegment(rel string) bool {
	for _, part := range strings.Split(rel, "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

var noteLocks sync.Map

func lockNote(path string) func() {
	mu := &sync.Mutex{}
	actual, _ := noteLocks.LoadOrStore(path, mu)
	lock := actual.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock
}
