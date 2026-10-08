package fileshare

import (
	"context"
	"encoding/json"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

const (
	OpTree      = "tree"
	OpChildren  = "children"
	OpHierarchy = "hierarchy"
	OpRead      = "read"
	OpWrite     = "write"
	OpCreate    = "create"
	OpMove      = "move"
	OpSearch    = "search"
)

type pathPayload struct {
	Path string `json:"path"`
}

type readPayload struct {
	Path       string `json:"path"`
	IfRevision string `json:"if_revision,omitempty"`
}

// ReadResult is a note, or a confirmation that the caller's revision is still
// current. NotModified responses omit the body so an unchanged note is not
// copied off the machine again.
type ReadResult struct {
	obsidianvault.FileContent
	NotModified bool `json:"not_modified,omitempty"`
}

type createPayload struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type movePayload struct {
	Path string `json:"path"`
	Dest string `json:"dest"`
}

type searchPayload struct {
	Q string `json:"q"`
}

// Exec runs one knowledge operation against a local directory. Listing and
// search stay on this machine; only the result is returned to the caller.
func Exec(ctx context.Context, root, op string, payload json.RawMessage) (any, error) {
	ctx = obsidianvault.WithSkipDirs(ctx, ShareDirs...)
	if len(payload) == 0 {
		payload = []byte(`{}`)
	}
	switch op {
	case OpTree:
		return obsidianvault.Tree(ctx, root)
	case OpChildren:
		var req pathPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Children(ctx, root, req.Path)
	case OpHierarchy:
		var req pathPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Hierarchy(ctx, root, req.Path)
	case OpRead:
		var req readPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		file, err := obsidianvault.Read(ctx, root, req.Path)
		if err != nil {
			return nil, err
		}
		if req.IfRevision != "" && req.IfRevision == file.Revision {
			file.Content = ""
			return ReadResult{FileContent: file, NotModified: true}, nil
		}
		return ReadResult{FileContent: file}, nil
	case OpWrite:
		var req obsidianvault.EditRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidEdit
		}
		return obsidianvault.Apply(ctx, root, req)
	case OpCreate:
		var req createPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Create(ctx, root, req.Path, req.Content)
	case OpMove:
		var req movePayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Move(ctx, root, req.Path, req.Dest)
	case OpSearch:
		var req searchPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrQueryRequired
		}
		return obsidianvault.Search(ctx, root, req.Q)
	default:
		return nil, obsidianvault.ErrInvalidPath
	}
}
