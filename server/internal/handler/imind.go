package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

const iMindDir = "iMind"

type iMindShareRequest struct {
	ShareMachine string `json:"share_machine"`
}

type iMindCreateRequest struct {
	iMindShareRequest
	Type       string       `json:"type"`
	Title      string       `json:"title"`
	Tags       []string     `json:"tags"`
	SourceURL  *string      `json:"source_url"`
	Content    string       `json:"content"`
	Transcript string       `json:"transcript"`
	Audio      *imind.Audio `json:"audio"`
}

type iMindUpdateRequest struct {
	iMindShareRequest
	Revision   string       `json:"revision"`
	Title      string       `json:"title"`
	Tags       []string     `json:"tags"`
	Content    string       `json:"content"`
	Transcript string       `json:"transcript"`
	Audio      *imind.Audio `json:"audio"`
}

type iMindNoteResponse struct {
	imind.Note
	Path     string `json:"path"`
	Revision string `json:"revision"`
}

func (h *Handler) GetIMindShares(w http.ResponseWriter, r *http.Request) {
	type share struct {
		Machine string `json:"machine"`
		Name    string `json:"name"`
	}
	peers := h.visiblePeers(r)
	out := make([]share, 0, len(peers))
	for _, peer := range peers {
		meta := peer.Meta()
		out = append(out, share{Machine: meta.Machine, Name: meta.Machine})
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": out})
}

func (h *Handler) PostIMindBootstrap(w http.ResponseWriter, r *http.Request) {
	var req iMindShareRequest
	if !decodeIMindBody(w, r, &req) {
		return
	}
	peer, ok := h.iMindPeer(w, r, req.ShareMachine)
	if !ok {
		return
	}
	if !h.ensureIMindDir(w, r, peer) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": fileshare.Join(peer.Meta().Machine, iMindDir)})
}

func (h *Handler) PostIMindNotesList(w http.ResponseWriter, r *http.Request) {
	var req struct {
		iMindShareRequest
		Tag string `json:"tag"`
	}
	if !decodeIMindBody(w, r, &req) {
		return
	}
	peer, ok := h.iMindPeer(w, r, req.ShareMachine)
	if !ok {
		return
	}
	if !h.ensureIMindDir(w, r, peer) {
		return
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var children obsidianvault.ChildrenResult
	if err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": iMindDir}, &children); err != nil {
		writeShareError(w, r, err)
		return
	}
	notes := make([]iMindNoteResponse, 0, len(children.Nodes))
	for _, node := range children.Nodes {
		if node.Type != obsidianvault.TypeFile || !strings.HasSuffix(strings.ToLower(node.Name), ".md") {
			continue
		}
		file, err := h.FileShares.Read(ctx, peer, node.Path)
		if err != nil {
			continue
		}
		note, err := imind.Parse(file.Content)
		if err != nil || (req.Tag != "" && !containsIMindTag(note.Tags, req.Tag)) {
			continue
		}
		notes = append(notes, iMindNoteResponse{Note: note, Path: fileshare.Join(peer.Meta().Machine, file.Path), Revision: file.Revision})
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].UpdatedAt.After(notes[j].UpdatedAt) })
	writeJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

func (h *Handler) PostIMindNote(w http.ResponseWriter, r *http.Request) {
	var req struct {
		iMindShareRequest
		ID string `json:"id"`
	}
	if !decodeIMindBody(w, r, &req) {
		return
	}
	peer, ok := h.iMindPeer(w, r, req.ShareMachine)
	if !ok {
		return
	}
	file, note, ok := h.readIMindNote(w, r, peer, req.ID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, iMindNoteResponse{Note: note, Path: fileshare.Join(peer.Meta().Machine, file.Path), Revision: file.Revision})
}

func (h *Handler) PostIMindNotes(w http.ResponseWriter, r *http.Request) {
	var req iMindCreateRequest
	if !decodeIMindBody(w, r, &req) {
		return
	}
	peer, ok := h.iMindPeer(w, r, req.ShareMachine)
	if !ok || !h.ensureIMindDir(w, r, peer) {
		return
	}
	note, err := imind.New(req.Type, req.Title, time.Now())
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_note", err.Error())
		return
	}
	note.Tags, note.SourceURL, note.Content, note.Transcript, note.Audio = req.Tags, req.SourceURL, req.Content, req.Transcript, req.Audio
	raw, err := note.Markdown()
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_note", err.Error())
		return
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var file obsidianvault.FileContent
	rel := path.Join(iMindDir, note.ID+".md")
	if err := peer.Call(ctx, fileshare.OpCreate, map[string]string{"path": rel, "content": raw}, &file); err != nil {
		writeShareError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, iMindNoteResponse{Note: note, Path: fileshare.Join(peer.Meta().Machine, file.Path), Revision: file.Revision})
}

func (h *Handler) PutIMindNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req iMindUpdateRequest
	if !decodeIMindBody(w, r, &req) {
		return
	}
	peer, ok := h.iMindPeer(w, r, req.ShareMachine)
	if !ok {
		return
	}
	file, note, ok := h.readIMindNote(w, r, peer, id)
	if !ok {
		return
	}
	if req.Revision != file.Revision {
		writeErrorCode(w, http.StatusConflict, "imind_conflict", "note changed since it was loaded")
		return
	}
	note.Title, note.Tags, note.Content, note.Transcript, note.Audio = req.Title, req.Tags, req.Content, req.Transcript, req.Audio
	note.UpdatedAt = time.Now().UTC()
	raw, err := note.Markdown()
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_note", err.Error())
		return
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var updated obsidianvault.FileContent
	if err := peer.Call(ctx, fileshare.OpWrite, obsidianvault.EditRequest{
		Path: file.Path, Op: "overwrite", Content: raw, BaseRevision: file.Revision,
	}, &updated); err != nil {
		writeShareError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, iMindNoteResponse{Note: note, Path: fileshare.Join(peer.Meta().Machine, updated.Path), Revision: updated.Revision})
}

func (h *Handler) DeleteIMindNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		iMindShareRequest
		Revision string `json:"revision"`
	}
	if !decodeIMindBody(w, r, &req) {
		return
	}
	peer, ok := h.iMindPeer(w, r, req.ShareMachine)
	if !ok {
		return
	}
	file, _, ok := h.readIMindNote(w, r, peer, id)
	if !ok {
		return
	}
	if req.Revision != file.Revision {
		writeErrorCode(w, http.StatusConflict, "imind_conflict", "note changed since it was loaded")
		return
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	if err := peer.Call(ctx, fileshare.OpDelete, map[string]string{"path": file.Path}, nil); err != nil {
		writeShareError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

func (h *Handler) iMindPeer(w http.ResponseWriter, r *http.Request, machine string) (fileshare.Peer, bool) {
	peer := h.peerFor(r, strings.TrimSpace(machine))
	if peer == nil {
		writeErrorCode(w, http.StatusNotFound, "imind_share_not_found", "iMind shared knowledge base not found")
		return nil, false
	}
	return peer, true
}

func (h *Handler) ensureIMindDir(w http.ResponseWriter, r *http.Request, peer fileshare.Peer) bool {
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var children obsidianvault.ChildrenResult
	err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": iMindDir}, &children)
	if err == nil {
		return true
	}
	if !errors.Is(err, obsidianvault.ErrNotFound) {
		writeShareError(w, r, err)
		return false
	}
	var entry obsidianvault.Entry
	if err := peer.Call(ctx, fileshare.OpMkdir, map[string]string{"path": iMindDir}, &entry); err != nil && !errors.Is(err, obsidianvault.ErrExists) {
		writeShareError(w, r, err)
		return false
	}
	return true
}

func (h *Handler) readIMindNote(w http.ResponseWriter, r *http.Request, peer fileshare.Peer, id string) (obsidianvault.FileContent, imind.Note, bool) {
	if strings.TrimSpace(id) == "" {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_note", "note id is required")
		return obsidianvault.FileContent{}, imind.Note{}, false
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	file, err := h.FileShares.Read(ctx, peer, path.Join(iMindDir, id+".md"))
	if err != nil {
		writeShareError(w, r, err)
		return obsidianvault.FileContent{}, imind.Note{}, false
	}
	note, err := imind.Parse(file.Content)
	if err != nil || note.ID != id {
		writeErrorCode(w, http.StatusConflict, "imind_invalid_note", "iMind note is malformed")
		return obsidianvault.FileContent{}, imind.Note{}, false
	}
	return file, note, true
}

func decodeIMindBody(w http.ResponseWriter, r *http.Request, dest any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	if err := json.NewDecoder(r.Body).Decode(dest); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

func containsIMindTag(tags []string, needle string) bool {
	for _, tag := range tags {
		if tag == needle {
			return true
		}
	}
	return false
}
