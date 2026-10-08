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

type docsMoveRequest struct {
	Path string `json:"path"`
	Dest string `json:"dest"`
}

// PostDocsTree returns every machine share the caller can use as a nested
// directory tree. Only markdown files are included, and directories with no
// markdown left after that filter are omitted.
func (h *Handler) PostDocsTree(w http.ResponseWriter, r *http.Request) {
	if !decodeDocsBody(w, r, &struct{}{}) {
		return
	}
	writeJSON(w, http.StatusOK, obsidianvault.TreeResult{Nodes: h.machineTrees(r)})
}

// PostDocsChildren returns the next visible level under path.
// An empty path lists the machine roots.
func (h *Handler) PostDocsChildren(w http.ResponseWriter, r *http.Request) {
	var req docsPathRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	if root, _ := fileshare.Cut(req.Path); root == "" {
		writeJSON(w, http.StatusOK, obsidianvault.ChildrenResult{Path: "", Nodes: h.machineLevels(r)})
		return
	}
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
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
	ctx, cancel := h.shareContext(r)
	defer cancel()
	file, err := h.FileShares.Read(ctx, target.peer, target.rel)
	if err != nil {
		writeShareError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, prefixFile(target.peer.Meta().Machine, file))
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
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var result obsidianvault.FileContent
	if err := target.peer.Call(ctx, fileshare.OpWrite, req, &result); err != nil {
		writeShareError(w, r, err)
		return
	}
	machine := target.peer.Meta().Machine
	h.FileShares.Invalidate(machine)
	writeJSON(w, http.StatusOK, prefixFile(machine, result))
}

// PostDocsMove places a markdown file or directory into another directory on
// the same machine. Dest is the destination directory; the bare machine name
// is the share root.
func (h *Handler) PostDocsMove(w http.ResponseWriter, r *http.Request) {
	var req docsMoveRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	from, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	machine := from.peer.Meta().Machine
	destRoot, destRel := fileshare.Cut(req.Dest)
	if destRoot != machine {
		writeDocsVaultError(w, r, obsidianvault.ErrInvalidMove)
		return
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var result obsidianvault.MoveResult
	if err := from.peer.Call(ctx, fileshare.OpMove, map[string]string{"path": from.rel, "dest": destRel}, &result); err != nil {
		writeShareError(w, r, err)
		return
	}
	h.FileShares.Invalidate(machine)
	result.From = fileshare.Join(machine, result.From)
	result.Path = fileshare.Join(machine, result.Path)
	writeJSON(w, http.StatusOK, result)
}

// PostDocsFile creates a markdown note inside an existing shared directory.
func (h *Handler) PostDocsFile(w http.ResponseWriter, r *http.Request) {
	var req docsCreateRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	target, ok := h.resolveDocsPath(w, r, req.Path)
	if !ok {
		return
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var result obsidianvault.FileContent
	if err := target.peer.Call(ctx, fileshare.OpCreate, map[string]string{"path": target.rel, "content": req.Content}, &result); err != nil {
		writeShareError(w, r, err)
		return
	}
	machine := target.peer.Meta().Machine
	h.FileShares.Invalidate(machine)
	writeJSON(w, http.StatusCreated, prefixFile(machine, result))
}

// PostDocsSearch finds notes by title or body across every machine share the
// caller can use and returns them inside their directories. A machine that
// fails to answer is left out rather than failing the whole search.
func (h *Handler) PostDocsSearch(w http.ResponseWriter, r *http.Request) {
	var req docsSearchRequest
	if !decodeDocsBody(w, r, &req) {
		return
	}
	if req.Q == "" {
		writeDocsVaultError(w, r, obsidianvault.ErrQueryRequired)
		return
	}
	result := obsidianvault.SearchResult{Query: req.Q, Nodes: []obsidianvault.Node{}}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	for _, peer := range h.visiblePeers(r) {
		var found obsidianvault.SearchResult
		if err := peer.Call(ctx, fileshare.OpSearch, map[string]string{"q": req.Q}, &found); err != nil {
			if errors.Is(err, obsidianvault.ErrQueryTooLong) {
				writeDocsVaultError(w, r, err)
				return
			}
			continue
		}
		result.Nodes = append(result.Nodes, prefixNodes(peer.Meta().Machine, found.Nodes)...)
		result.Truncated = result.Truncated || found.Truncated
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
	default:
		slog.Error("docs request failed", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to read documents")
	}
}
