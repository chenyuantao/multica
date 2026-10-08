package fileshare

import (
	"errors"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

var (
	errBadMachine    = errors.New("invalid machine name")
	errBadVisibility = errors.New("visibility must be private or workspace")
	ErrMachineTaken  = errors.New("machine name is already shared by another user")
)

// ShareDirs is the directory names a machine share does not walk. The bytes
// stay on disk; they are just not part of the knowledge tree.
var ShareDirs = []string{"node_modules", "vendor", "dist", "build", "target", "__pycache__"}

// codedError is the wire form of a vault error. The daemon fills it from the
// local filesystem error, and the server rebuilds the same Go error so the
// docs handlers keep their existing status codes.
type codedError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Revision   string `json:"revision,omitempty"`
	ModifiedAt string `json:"modified_at,omitempty"`
	Reason     string `json:"reason,omitempty"`
	Content    string `json:"content,omitempty"`
}

func encodeError(err error) *codedError {
	if err == nil {
		return nil
	}
	var conflict *obsidianvault.ConflictError
	if errors.As(err, &conflict) {
		return &codedError{
			Code:       "docs_conflict",
			Message:    conflict.Error(),
			Revision:   conflict.Revision,
			ModifiedAt: conflict.ModifiedAt,
			Reason:     conflict.Reason,
		}
	}
	var merged *obsidianvault.MergeConflictError
	if errors.As(err, &merged) {
		return &codedError{
			Code:     "docs_merge_conflict",
			Message:  merged.Error(),
			Revision: merged.Revision,
			Content:  merged.Content,
		}
	}
	code := "file_share_failed"
	switch {
	case errors.Is(err, obsidianvault.ErrInvalidPath):
		code = "invalid_docs_path"
	case errors.Is(err, obsidianvault.ErrNotFound):
		code = "docs_not_found"
	case errors.Is(err, obsidianvault.ErrNotFile):
		code = "docs_not_file"
	case errors.Is(err, obsidianvault.ErrExists):
		code = "docs_exists"
	case errors.Is(err, obsidianvault.ErrNotDir):
		code = "docs_not_directory"
	case errors.Is(err, obsidianvault.ErrInvalidMove):
		code = "docs_invalid_move"
	case errors.Is(err, obsidianvault.ErrQueryRequired):
		code = "docs_query_required"
	case errors.Is(err, obsidianvault.ErrQueryTooLong):
		code = "docs_query_too_long"
	case errors.Is(err, obsidianvault.ErrInvalidEdit):
		code = "docs_invalid_edit"
	case errors.Is(err, obsidianvault.ErrNotUTF8):
		code = "docs_not_utf8"
	case errors.Is(err, obsidianvault.ErrTooLarge):
		code = "docs_too_large"
	}
	return &codedError{Code: code, Message: err.Error()}
}

func decodeError(c *codedError) error {
	if c == nil {
		return errors.New("file share request failed")
	}
	switch c.Code {
	case "docs_conflict":
		return &obsidianvault.ConflictError{ModifiedAt: c.ModifiedAt, Revision: c.Revision, Reason: c.Reason}
	case "docs_merge_conflict":
		return &obsidianvault.MergeConflictError{Content: c.Content, Revision: c.Revision}
	case "invalid_docs_path":
		return obsidianvault.ErrInvalidPath
	case "docs_not_found":
		return obsidianvault.ErrNotFound
	case "docs_not_file":
		return obsidianvault.ErrNotFile
	case "docs_exists":
		return obsidianvault.ErrExists
	case "docs_not_directory":
		return obsidianvault.ErrNotDir
	case "docs_invalid_move":
		return obsidianvault.ErrInvalidMove
	case "docs_query_required":
		return obsidianvault.ErrQueryRequired
	case "docs_query_too_long":
		return obsidianvault.ErrQueryTooLong
	case "docs_invalid_edit":
		return obsidianvault.ErrInvalidEdit
	case "docs_not_utf8":
		return obsidianvault.ErrNotUTF8
	case "docs_too_large":
		return obsidianvault.ErrTooLarge
	default:
		if c.Message != "" {
			return errors.New(c.Message)
		}
		return errors.New("file share request failed")
	}
}
