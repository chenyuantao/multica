package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

type docsPathRequest struct {
	Path string `json:"path"`
}

type docsSearchRequest struct {
	Q string `json:"q"`
}

type docsVersionRequest struct {
	Path    string `json:"path"`
	Source  string `json:"source"`
	Version int    `json:"version"`
}

// PostDocsTree returns the Obsidian vault as a nested directory tree.
// Only markdown files are included, and directories with no markdown left
// after that filter are omitted.
func (h *Handler) PostDocsTree(w http.ResponseWriter, r *http.Request) {
	if !decodeDocsBody(w, r, &struct{}{}) {
		return
	}
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.Tree(r.Context(), root)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// PostDocsChildren returns the next visible level under path.
// An empty path lists the vault root.
func (h *Handler) PostDocsChildren(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.Children(r.Context(), root, req.Path)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// PostDocsFileHierarchy returns one markdown file and the directories above it.
func (h *Handler) PostDocsFileHierarchy(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.Hierarchy(r.Context(), root, req.Path)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// PostDocsFileContent returns the full text of one markdown note.
func (h *Handler) PostDocsFileContent(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.Read(r.Context(), root, req.Path)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// PostDocsFileHistory lists File recovery and Sync versions via the Obsidian CLI.
func (h *Handler) PostDocsFileHistory(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.History(r.Context(), root, req.Path)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// PostDocsFileVersion reads one historical version via the Obsidian CLI.
func (h *Handler) PostDocsFileVersion(w http.ResponseWriter, r *http.Request) {
	var req docsVersionRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.ReadVersion(r.Context(), root, req.Path, req.Source, req.Version)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// PatchDocsFileContent writes a note. Range edits use changes; op overwrite,
// append, or prepend follows the Obsidian CLI write commands. The disk write
// is always a full replacement of the file.
func (h *Handler) PatchDocsFileContent(w http.ResponseWriter, r *http.Request) {
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	var req obsidianvault.EditRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	result, err := obsidianvault.Apply(r.Context(), root, req)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// PostDocsSearch finds notes by title or body and returns them inside their directories.
func (h *Handler) PostDocsSearch(w http.ResponseWriter, r *http.Request) {
	var req docsSearchRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.Search(r.Context(), root, req.Q)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func decodeDocsBody(w http.ResponseWriter, r *http.Request, dest any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	err := json.NewDecoder(r.Body).Decode(dest)
	if err == io.EOF {
		return true
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

func requireDocsVault(w http.ResponseWriter) (string, bool) {
	root, err := obsidianvault.VaultRoot()
	if err != nil {
		writeDocsVaultError(w, nil, err)
		return "", false
	}
	return root, true
}

func writeDocsVaultError(w http.ResponseWriter, r *http.Request, err error) {
	if r != nil && errors.Is(err, r.Context().Err()) {
		return
	}
	var conflict *obsidianvault.ConflictError
	if errors.As(err, &conflict) {
		body := map[string]string{
			"error":       "document changed since it was loaded",
			"code":        "docs_conflict",
			"modified_at": conflict.ModifiedAt,
			"revision":    conflict.Revision,
		}
		if conflict.Reason != "" {
			body["reason"] = conflict.Reason
		}
		writeJSON(w, http.StatusConflict, body)
		return
	}
	var merged *obsidianvault.MergeConflictError
	if errors.As(err, &merged) {
		writeJSON(w, http.StatusConflict, map[string]string{
			"error":    "document changes overlap",
			"code":     "docs_merge_conflict",
			"content":  merged.Content,
			"revision": merged.Revision,
		})
		return
	}
	switch {
	case errors.Is(err, obsidianvault.ErrUnconfigured):
		writeErrorCode(w, http.StatusNotFound, "obsidian_vault_unconfigured", "Obsidian vault is not configured")
	case errors.Is(err, obsidianvault.ErrUnavailable):
		writeErrorCode(w, http.StatusNotFound, "obsidian_vault_unavailable", "Obsidian vault is unavailable")
	case errors.Is(err, obsidianvault.ErrInvalidPath):
		writeErrorCode(w, http.StatusBadRequest, "invalid_docs_path", "invalid document path")
	case errors.Is(err, obsidianvault.ErrNotFound):
		writeErrorCode(w, http.StatusNotFound, "docs_not_found", "document not found")
	case errors.Is(err, obsidianvault.ErrNotFile):
		writeErrorCode(w, http.StatusBadRequest, "docs_not_file", "path is not a markdown file")
	case errors.Is(err, obsidianvault.ErrNotDir):
		writeErrorCode(w, http.StatusBadRequest, "docs_not_directory", "path is not a directory")
	case errors.Is(err, obsidianvault.ErrQueryRequired):
		writeErrorCode(w, http.StatusBadRequest, "docs_query_required", "search query is required")
	case errors.Is(err, obsidianvault.ErrQueryTooLong):
		writeErrorCode(w, http.StatusBadRequest, "docs_query_too_long", "search query is too long")
	case errors.Is(err, obsidianvault.ErrInvalidEdit):
		writeErrorCode(w, http.StatusBadRequest, "docs_invalid_edit", "invalid document edit")
	case errors.Is(err, obsidianvault.ErrNotUTF8):
		writeErrorCode(w, http.StatusBadRequest, "docs_not_utf8", "document is not utf-8")
	case errors.Is(err, obsidianvault.ErrTooLarge):
		writeErrorCode(w, http.StatusRequestEntityTooLarge, "docs_too_large", "document is too large")
	case errors.Is(err, obsidianvault.ErrCLIUnavailable):
		writeErrorCode(w, http.StatusServiceUnavailable, "obsidian_cli_unavailable", "Obsidian CLI is unavailable")
	case errors.Is(err, obsidianvault.ErrCLIFailed):
		writeErrorCode(w, http.StatusBadGateway, "obsidian_cli_failed", "Obsidian CLI failed")
	default:
		slog.Error("docs vault request failed", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to read documents")
	}
}
