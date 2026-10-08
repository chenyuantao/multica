package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

type docsPathRequest struct {
	Path string `json:"path"`
}

type docsSearchRequest struct {
	Q string `json:"q"`
}

type docsCreateRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type docsVersionRequest struct {
	Path    string `json:"path"`
	Source  string `json:"source"`
	Version int    `json:"version"`
}

type docsMoveRequest struct {
	Path string `json:"path"`
	Dest string `json:"dest"`
}

// PostDocsTree returns the Obsidian vault as a nested directory tree.
// Only markdown files are included, and directories with no markdown left
// after that filter are omitted.
func (h *Handler) PostDocsTree(w http.ResponseWriter, r *http.Request) {
	if !decodeDocsBody(w, r, &struct{}{}) {
		return
	}
	nodes := make([]obsidianvault.Node, 0, 2)
	root, err := obsidianvault.VaultRoot()
	switch {
	case err == nil:
		result, treeErr := obsidianvault.Tree(r.Context(), root)
		if treeErr != nil {
			writeDocsVaultError(w, r, treeErr)
			return
		}
		nodes = append(nodes, systemNode(result.Nodes))
	case errors.Is(err, obsidianvault.ErrUnconfigured):
	default:
		writeDocsVaultError(w, r, err)
		return
	}
	nodes = append(nodes, h.machineTrees(r)...)
	if len(nodes) == 0 {
		writeDocsVaultError(w, r, obsidianvault.ErrUnconfigured)
		return
	}
	writeJSON(w, http.StatusOK, obsidianvault.TreeResult{Nodes: nodes})
}

// PostDocsChildren returns the next visible level under path.
// An empty path lists the vault root.
func (h *Handler) PostDocsChildren(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	if trimSlash(req.Path) == "" {
		h.writeDocsRoots(w, r)
		return
	}
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	if target.peer != nil {
		ctx, cancel := h.shareContext(r)
		defer cancel()
		var result obsidianvault.ChildrenResult
		if err := target.peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": target.rel}, &result); err != nil {
			writeShareError(w, r, err)
			return
		}
		machine := target.peer.Meta().Machine
		result.Path = fileshare.Join(machine, result.Path)
		result.Nodes = prefixNodes(machine, result.Nodes)
		writeJSON(w, http.StatusOK, result)
		return
	}
	result, err := obsidianvault.Children(r.Context(), target.vault, target.rel)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	result.Path = fileshare.Join(fileshare.SystemRoot, result.Path)
	result.Nodes = prefixNodes(fileshare.SystemRoot, result.Nodes)
	writeJSON(w, http.StatusOK, result)
}

// PostDocsFileHierarchy returns one markdown file and the directories above it.
func (h *Handler) PostDocsFileHierarchy(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	if target.peer != nil {
		ctx, cancel := h.shareContext(r)
		defer cancel()
		var result obsidianvault.HierarchyResult
		if err := target.peer.Call(ctx, fileshare.OpHierarchy, map[string]string{"path": target.rel}, &result); err != nil {
			writeShareError(w, r, err)
			return
		}
		machine := target.peer.Meta().Machine
		result.File = prefixNode(machine, result.File)
		result.Ancestors = prefixNodes(machine, result.Ancestors)
		writeJSON(w, http.StatusOK, result)
		return
	}
	result, err := obsidianvault.Hierarchy(r.Context(), target.vault, target.rel)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	result.File = prefixNode(fileshare.SystemRoot, result.File)
	result.Ancestors = prefixNodes(fileshare.SystemRoot, result.Ancestors)
	writeJSON(w, http.StatusOK, result)
}

// PostDocsFileContent returns the full text of one markdown note.
func (h *Handler) PostDocsFileContent(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	if target.peer != nil {
		ctx, cancel := h.shareContext(r)
		defer cancel()
		file, err := h.FileShares.Read(ctx, target.peer, target.rel)
		if err != nil {
			writeShareError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, prefixFile(target.peer.Meta().Machine, file))
		return
	}
	result, err := obsidianvault.Read(r.Context(), target.vault, target.rel)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, prefixFile(fileshare.SystemRoot, result))
}

// PostDocsFileHistory lists File recovery and Sync versions via the Obsidian CLI.
func (h *Handler) PostDocsFileHistory(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	if target.peer != nil {
		writeErrorCode(w, http.StatusBadRequest, "docs_history_unavailable", "version history is only available for system documents")
		return
	}
	result, err := obsidianvault.History(r.Context(), target.vault, target.rel)
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
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	if target.peer != nil {
		writeErrorCode(w, http.StatusBadRequest, "docs_history_unavailable", "version history is only available for system documents")
		return
	}
	result, err := obsidianvault.ReadVersion(r.Context(), target.vault, target.rel, req.Source, req.Version)
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
	var req obsidianvault.EditRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	req.Path = target.rel
	if target.peer != nil {
		ctx, cancel := h.shareContext(r)
		defer cancel()
		var result obsidianvault.FileContent
		if err := target.peer.Call(ctx, fileshare.OpWrite, req, &result); err != nil {
			writeShareError(w, r, err)
			return
		}
		h.FileShares.Invalidate(target.peer.Meta().Machine)
		writeJSON(w, http.StatusOK, prefixFile(target.peer.Meta().Machine, result))
		return
	}
	result, err := obsidianvault.Apply(r.Context(), target.vault, req)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, prefixFile(fileshare.SystemRoot, result))
}

// PostDocsMove places a markdown file or directory into another directory.
// Dest is the destination directory; an empty dest is the vault root.
func (h *Handler) PostDocsMove(w http.ResponseWriter, r *http.Request) {
	var req docsMoveRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	from, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	destRoot, destRest := fileshare.Cut(req.Dest)
	if destRoot == "" {
		destRoot = fileshare.SystemRoot
	}
	fromRoot := fileshare.SystemRoot
	if from.peer != nil {
		fromRoot = from.peer.Meta().Machine
	}
	destRel := req.Dest
	if from.peer != nil {
		if destRoot != fromRoot {
			writeDocsVaultError(w, r, obsidianvault.ErrInvalidMove)
			return
		}
		destRel = destRest
		ctx, cancel := h.shareContext(r)
		defer cancel()
		var result obsidianvault.MoveResult
		if err := from.peer.Call(ctx, fileshare.OpMove, map[string]string{"path": from.rel, "dest": destRel}, &result); err != nil {
			writeShareError(w, r, err)
			return
		}
		h.FileShares.Invalidate(fromRoot)
		result.From = fileshare.Join(fromRoot, result.From)
		result.Path = fileshare.Join(fromRoot, result.Path)
		writeJSON(w, http.StatusOK, result)
		return
	}
	if destRoot != fileshare.SystemRoot && h.peerFor(r, destRoot) != nil {
		writeDocsVaultError(w, r, obsidianvault.ErrInvalidMove)
		return
	}
	if destRoot == fileshare.SystemRoot {
		destRel = destRest
	}
	result, err := obsidianvault.Move(r.Context(), from.vault, from.rel, trimSlash(destRel))
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	result.From = fileshare.Join(fileshare.SystemRoot, result.From)
	result.Path = fileshare.Join(fileshare.SystemRoot, result.Path)
	writeJSON(w, http.StatusOK, result)
}

// PostDocsFile creates a markdown note inside an existing vault directory.
func (h *Handler) PostDocsFile(w http.ResponseWriter, r *http.Request) {
	var req docsCreateRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	if target.peer != nil {
		ctx, cancel := h.shareContext(r)
		defer cancel()
		var result obsidianvault.FileContent
		if err := target.peer.Call(ctx, fileshare.OpCreate, map[string]string{"path": target.rel, "content": req.Content}, &result); err != nil {
			writeShareError(w, r, err)
			return
		}
		h.FileShares.Invalidate(target.peer.Meta().Machine)
		writeJSON(w, http.StatusCreated, prefixFile(target.peer.Meta().Machine, result))
		return
	}
	result, err := obsidianvault.Create(r.Context(), target.vault, target.rel, req.Content)
	if err != nil {
		writeDocsVaultError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, prefixFile(fileshare.SystemRoot, result))
}

// PostDocsSearch finds notes by title or body and returns them inside their directories.
func (h *Handler) PostDocsSearch(w http.ResponseWriter, r *http.Request) {
	var req docsSearchRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	var result obsidianvault.SearchResult
	root, err := obsidianvault.VaultRoot()
	if err == nil {
		found, searchErr := obsidianvault.Search(r.Context(), root, req.Q)
		if searchErr != nil {
			writeDocsVaultError(w, r, searchErr)
			return
		}
		result = found
		result.Nodes = prefixNodes(fileshare.SystemRoot, found.Nodes)
	} else if !errors.Is(err, obsidianvault.ErrUnconfigured) {
		writeDocsVaultError(w, r, err)
		return
	} else if req.Q == "" {
		writeDocsVaultError(w, r, obsidianvault.ErrQueryRequired)
		return
	}
	if result.Query == "" {
		result.Query = req.Q
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	for _, peer := range h.visiblePeers(r) {
		var found obsidianvault.SearchResult
		if err := peer.Call(ctx, fileshare.OpSearch, map[string]string{"q": req.Q}, &found); err != nil {
			continue
		}
		result.Nodes = append(result.Nodes, prefixNodes(peer.Meta().Machine, found.Nodes)...)
		result.Truncated = result.Truncated || found.Truncated
	}
	if result.Nodes == nil {
		result.Nodes = []obsidianvault.Node{}
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
	case errors.Is(err, obsidianvault.ErrExists):
		writeErrorCode(w, http.StatusConflict, "docs_exists", "document already exists")
	case errors.Is(err, obsidianvault.ErrNotDir):
		writeErrorCode(w, http.StatusBadRequest, "docs_not_directory", "path is not a directory")
	case errors.Is(err, obsidianvault.ErrInvalidMove):
		writeErrorCode(w, http.StatusBadRequest, "docs_invalid_move", "cannot move a folder into itself")
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
