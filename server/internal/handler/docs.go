package handler

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

// GetDocsTree returns the Obsidian vault as a nested directory tree.
// Only markdown files are included, and directories with no markdown left
// after that filter are omitted.
func (h *Handler) GetDocsTree(w http.ResponseWriter, r *http.Request) {
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

// GetDocsChildren returns the next visible level under path.
// An empty path lists the vault root.
func (h *Handler) GetDocsChildren(w http.ResponseWriter, r *http.Request) {
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.Children(r.Context(), root, r.URL.Query().Get("path"))
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// GetDocsFileHierarchy returns one markdown file and the directories above it.
func (h *Handler) GetDocsFileHierarchy(w http.ResponseWriter, r *http.Request) {
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.Hierarchy(r.Context(), root, r.URL.Query().Get("path"))
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// SearchDocs finds notes by title or body and returns them inside their directories.
func (h *Handler) SearchDocs(w http.ResponseWriter, r *http.Request) {
	root, ok := requireDocsVault(w)
	if !ok {
		return
	}
	result, err := obsidianvault.Search(r.Context(), root, r.URL.Query().Get("q"))
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
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
	default:
		slog.Error("docs vault request failed", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to read documents")
	}
}
