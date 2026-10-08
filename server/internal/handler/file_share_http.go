package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

type fileShareResponse struct {
	DaemonID    string `json:"daemon_id"`
	Machine     string `json:"machine"`
	Dir         string `json:"dir"`
	Visibility  string `json:"visibility"`
	Enabled     bool   `json:"enabled"`
	Online      bool   `json:"online"`
	WorkspaceID string `json:"workspace_id"`
}

// ListFileShares returns the caller's shared directories in this workspace,
// one per machine. daemon_id matches the runtimes' daemon_id so the runtime
// page can place each share on its machine. The absolute path is included so
// that page can show it. Other members do not receive someone else's path.
func (h *Handler) ListFileShares(w http.ResponseWriter, r *http.Request) {
	if h.FileShares == nil {
		writeJSON(w, http.StatusOK, map[string]any{"shares": []fileShareResponse{}})
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace is required")
		return
	}
	records := h.FileShares.Records(userID, workspaceID)
	shares := make([]fileShareResponse, 0, len(records))
	for _, record := range records {
		shares = append(shares, fileShareView(record))
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": shares})
}

// UpdateFileShare turns remote access on or off and sets who can open the
// directory. The shared path cannot be changed from this request.
func (h *Handler) UpdateFileShare(w http.ResponseWriter, r *http.Request) {
	if h.FileShares == nil {
		writeError(w, http.StatusServiceUnavailable, "file shares are not available")
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if _, exists := raw["dir"]; exists {
		writeError(w, http.StatusBadRequest, "shared path cannot be changed")
		return
	}
	var patch struct {
		Visibility *string `json:"visibility"`
		Enabled    *bool   `json:"enabled"`
	}
	if err := json.Unmarshal(body, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if patch.Visibility == nil && patch.Enabled == nil {
		writeError(w, http.StatusBadRequest, "nothing to update")
		return
	}
	daemonID := chi.URLParam(r, "daemonId")
	updated, err := h.FileShares.UpdateAccess(userID, daemonID, fileshare.AccessPatch{
		Visibility: patch.Visibility,
		Enabled:    patch.Enabled,
	})
	if err != nil {
		if errors.Is(err, obsidianvault.ErrNotFound) {
			writeError(w, http.StatusNotFound, "file share not found")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, fileShareView(updated))
}

func fileShareView(record fileshare.ShareMeta) fileShareResponse {
	visibility := record.Visibility
	if visibility == "" {
		visibility = fileshare.VisibilityPrivate
	}
	return fileShareResponse{
		DaemonID:    record.DaemonID,
		Machine:     record.Machine,
		Dir:         record.Dir,
		Visibility:  visibility,
		Enabled:     record.Enabled,
		Online:      record.Online,
		WorkspaceID: record.WorkspaceID,
	}
}
