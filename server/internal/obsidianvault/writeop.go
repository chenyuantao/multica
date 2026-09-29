package obsidianvault

import (
	"context"
	"strings"
)

// applyInstruction runs overwrite, append, or prepend and writes the whole file.
func applyInstruction(ctx context.Context, root, op string, req EditRequest) (FileContent, error) {
	if err := ctx.Err(); err != nil {
		return FileContent{}, err
	}
	if strings.ContainsRune(req.Content, '\x00') || len(req.Changes) > 0 {
		return FileContent{}, ErrInvalidEdit
	}
	if op != "overwrite" && req.Content == "" {
		return FileContent{}, ErrInvalidEdit
	}
	if op == "overwrite" && req.Inline {
		return FileContent{}, ErrInvalidEdit
	}
	if op == "overwrite" && strings.TrimSpace(req.BaseRevision) == "" {
		return FileContent{}, ErrInvalidEdit
	}
	resolved, cleaned, err := openNote(root, req.Path)
	if err != nil {
		return FileContent{}, err
	}
	unlock := lockNote(resolved)
	locked := true
	defer func() {
		if locked {
			unlock()
		}
	}()
	current, err := loadNote(resolved, cleaned)
	if err != nil {
		return FileContent{}, err
	}
	if op == "overwrite" && current.Revision != strings.TrimSpace(req.BaseRevision) && req.Resolve == "merge" && req.BaseContent == nil {
		unlock()
		locked = false
		found, err := FindRevision(ctx, root, cleaned, strings.TrimSpace(req.BaseRevision))
		if err != nil {
			return FileContent{}, err
		}
		req.BaseContent = &found
		unlock = lockNote(resolved)
		locked = true
		current, err = loadNote(resolved, cleaned)
		if err != nil {
			return FileContent{}, err
		}
	}
	updated, err := instructionText(ctx, op, current, req)
	if err != nil {
		return FileContent{}, err
	}
	if updated == current.Content {
		return current, nil
	}
	if len(updated) > maxNoteBytes {
		return FileContent{}, ErrTooLarge
	}
	if err := writeFull(resolved, []byte(updated)); err != nil {
		return FileContent{}, err
	}
	return loadNote(resolved, cleaned)
}

func instructionText(ctx context.Context, op string, current FileContent, req EditRequest) (string, error) {
	switch op {
	case "append":
		return joinEdge(current.Content, req.Content, false, req.Inline), nil
	case "prepend":
		return joinEdge(current.Content, req.Content, true, req.Inline), nil
	case "overwrite":
		return overwriteText(ctx, current, req)
	default:
		return "", ErrInvalidEdit
	}
}

func overwriteText(ctx context.Context, current FileContent, req EditRequest) (string, error) {
	rev := strings.TrimSpace(req.BaseRevision)
	if current.Revision == rev {
		return req.Content, nil
	}
	if req.Resolve != "merge" {
		if req.Resolve != "" {
			return "", ErrInvalidEdit
		}
		return "", &ConflictError{ModifiedAt: current.ModifiedAt, Revision: current.Revision}
	}
	if req.BaseContent == nil {
		return "", &ConflictError{ModifiedAt: current.ModifiedAt, Revision: current.Revision, Reason: "base version not found"}
	}
	base := *req.BaseContent
	if contentRevision([]byte(base)) != rev {
		return "", ErrInvalidEdit
	}
	merged, clean, err := merge3(ctx, req.Content, base, current.Content)
	if err != nil {
		return "", err
	}
	if !clean {
		return "", &MergeConflictError{Content: merged, Revision: current.Revision}
	}
	return merged, nil
}

// joinEdge appends or prepends content. Prepend goes after YAML frontmatter.
// Without inline, a newline separates the existing text from the addition
// when they would otherwise stick together.
func joinEdge(existing, addition string, prepend, inline bool) string {
	if prepend {
		if head, rest, ok := frontmatterHead(existing); ok {
			return head + separate(addition, rest, inline)
		}
		return separate(addition, existing, inline)
	}
	return separate(existing, addition, inline)
}

func separate(left, right string, inline bool) string {
	if inline || left == "" || right == "" || strings.HasSuffix(left, "\n") {
		return left + right
	}
	return left + "\n" + right
}

func frontmatterHead(s string) (head, rest string, ok bool) {
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
		closing = lineEnd + "---"
		idx = strings.Index(body, closing)
		if idx < 0 || idx+len(closing) != len(body) {
			return "", s, false
		}
	}
	headLen := len("---") + len(lineEnd) + idx + len(closing)
	return s[:headLen], s[headLen:], true
}
