package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

func (h *Handler) syncIMindAgentInstructions(w http.ResponseWriter, r *http.Request, ctx context.Context, peer fileshare.Peer) bool {
	if err := distributeIMindAgentInstructions(ctx, peer); err != nil {
		writeShareError(w, r, err)
		return false
	}
	return true
}

// distributeIMindAgentInstructions uses the existing protocol so guide changes
// only require a backend release. User-owned files are never overwritten.
func distributeIMindAgentInstructions(ctx context.Context, peer fileshare.Peer) error {
	const guidePath = iMindDir + "/AGENTS.md"
	var file fileshare.ReadResult
	err := peer.Call(ctx, fileshare.OpRead, map[string]string{
		"path": guidePath, "scope": fileshare.IMindScope,
	}, &file)
	if errors.Is(err, obsidianvault.ErrNotFound) {
		var created obsidianvault.FileContent
		err = peer.Call(ctx, fileshare.OpCreate, map[string]string{
			"path": guidePath, "scope": fileshare.IMindScope, "content": imind.AgentInstructions,
		}, &created)
		if errors.Is(err, obsidianvault.ErrExists) {
			return nil
		}
		return err
	}
	if errors.Is(err, obsidianvault.ErrInvalidPath) || errors.Is(err, obsidianvault.ErrNotFile) {
		return nil
	}
	if err != nil {
		return err
	}
	if file.Content == imind.AgentInstructions || !strings.HasPrefix(file.Content, "<!-- imind:managed-agent-instructions -->\n") {
		return nil
	}
	var updated obsidianvault.FileContent
	err = peer.Call(ctx, fileshare.OpWrite, obsidianvault.EditRequest{
		Scope: fileshare.IMindScope, Path: guidePath, Op: "overwrite",
		Content: imind.AgentInstructions, BaseRevision: file.Revision,
	}, &updated)
	// A concurrent edit wins; re-evaluate ownership on the next initialization.
	if errors.Is(err, obsidianvault.ErrConflict) {
		return nil
	}
	return err
}
