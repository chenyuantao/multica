package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

const iMindDir = "iMind"

var iMindLocks [64]sync.Mutex

func lockIMindNote(machine, id string) func() {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(machine + "\x00" + id))
	mu := &iMindLocks[hash.Sum32()%uint32(len(iMindLocks))]
	mu.Lock()
	return mu.Unlock
}

type iMindShareRequest struct {
	ShareMachine string `json:"share_machine"`
}

type iMindCreateRequest struct {
	iMindShareRequest
	Type       string              `json:"type"`
	Title      string              `json:"title"`
	Tags       []string            `json:"tags"`
	SourceURL  *string             `json:"source_url"`
	Content    string              `json:"content"`
	Transcript string              `json:"transcript"`
	Audio      *imind.Audio        `json:"audio"`
	Clip       *imind.ClipMetadata `json:"clip"`
}

type iMindUpdateRequest struct {
	Summary *string `json:"summary"`
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
	var peers []fileshare.Peer
	if h.FileShares != nil {
		peers = h.FileShares.List()
	}
	out := make([]share, 0, len(peers))
	needsUpgrade := false
	for _, peer := range peers {
		meta := peer.Meta()
		if !h.canUseIMindShare(r, meta) {
			continue
		}
		if !meta.IMindScopeRevision || !meta.IMindRename || !meta.IMindMedia {
			needsUpgrade = true
			continue
		}
		out = append(out, share{Machine: meta.Machine, Name: meta.Machine})
	}
	if len(out) == 0 && needsUpgrade {
		writeErrorCode(w, http.StatusConflict, "imind_daemon_upgrade_required", "file-share daemon must be upgraded to use iMind media")
		return
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Machine < out[j].Machine })
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

// imindExistingTags reads the same scoped, parseable saved notes as the list endpoint.
func (h *Handler) imindExistingTags(ctx context.Context, peer fileshare.Peer) ([]string, error) {
	var children obsidianvault.ChildrenResult
	if err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": iMindDir, "scope": fileshare.IMindScope}, &children); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	tags := []string{}
	for _, node := range children.Nodes {
		if node.Type != obsidianvault.TypeFile || !strings.HasSuffix(node.Name, ".md") || node.Path != iMindDir+"/"+node.Name {
			continue
		}
		file, err := h.FileShares.ReadScoped(ctx, peer, node.Path, fileshare.IMindScope)
		if err != nil || file.Path != node.Path {
			continue
		}
		note, err := imind.Parse(file.Content, strings.TrimSuffix(node.Name, ".md"))
		if err != nil {
			continue
		}
		for _, tag := range note.Tags {
			if !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
	}
	sort.Strings(tags)
	return tags, nil
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
	if err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": iMindDir, "scope": fileshare.IMindScope}, &children); err != nil {
		writeShareError(w, r, err)
		return
	}
	notes := make([]iMindNoteResponse, 0, len(children.Nodes))
	for _, node := range children.Nodes {
		if node.Type != obsidianvault.TypeFile || !strings.HasSuffix(node.Name, ".md") || node.Path != iMindDir+"/"+node.Name {
			continue
		}
		file, err := h.FileShares.ReadScoped(ctx, peer, node.Path, fileshare.IMindScope)
		if err != nil {
			continue
		}
		note, err := imind.Parse(file.Content, strings.TrimSuffix(path.Base(file.Path), ".md"))
		if err != nil || file.Path != node.Path || (req.Tag != "" && !containsIMindTag(note.Tags, req.Tag)) {
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
	note.Clip = req.Clip
	if note.Type == "clip" {
		note.Title = "生成中的剪藏"
		if note.Clip == nil {
			note.Clip = &imind.ClipMetadata{OriginalText: req.Content}
		}
		note.Content = ""
	}
	if err := note.Validate(); err != nil {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_note", err.Error())
		return
	}
	raw, err := note.Markdown()
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_note", err.Error())
		return
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var file obsidianvault.FileContent
	base := iMindFilename(note.Title)
	for suffix := 1; ; suffix++ {
		name := base
		if suffix > 1 {
			name += fmt.Sprintf(" (%d)", suffix)
		}
		err := peer.Call(ctx, fileshare.OpCreate, map[string]string{"path": path.Join(iMindDir, name+".md"), "content": raw, "scope": fileshare.IMindScope}, &file)
		if errors.Is(err, obsidianvault.ErrExists) {
			continue
		}
		if err != nil {
			writeShareError(w, r, err)
			return
		}
		note.Title = name
		break
	}
	writeJSON(w, http.StatusCreated, iMindNoteResponse{Note: note, Path: fileshare.Join(peer.Meta().Machine, file.Path), Revision: file.Revision})
	if note.Type == "clip" && note.SourceURL != nil {
		member, ok := ctxMember(r.Context())
		if ok {
			background := context.WithoutCancel(r.Context())
			go func() {
				ctx, cancel := context.WithTimeout(background, 110*time.Second)
				defer cancel()
				h.nameInitialIMindClip(ctx, member.WorkspaceID, peer, note, file)
			}()
		}
	}
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
	unlock := lockIMindNote(peer.Meta().Machine, id)
	defer unlock()
	file, note, ok := h.readIMindNote(w, r, peer, id)
	if !ok {
		return
	}
	if req.Revision != file.Revision {
		writeIMindConflict(w, file.Revision)
		return
	}
	note.Title, note.Tags, note.Content, note.Transcript, note.Audio = req.Title, req.Tags, req.Content, req.Transcript, req.Audio
	if req.Summary != nil {
		note.Summary = *req.Summary
	}
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
		Path: file.Path, Op: "overwrite", Content: raw, BaseRevision: file.Revision, Scope: fileshare.IMindScope,
	}, &updated); err != nil {
		var conflict *obsidianvault.ConflictError
		if errors.As(err, &conflict) {
			writeIMindConflict(w, conflict.Revision)
			return
		}
		writeShareError(w, r, err)
		return
	}
	updated.Path, err = h.renameIMindNote(ctx, peer, note.ID, updated.Path, note.Title)
	if err != nil {
		writeShareError(w, r, err)
		return
	}
	note.Title = strings.TrimSuffix(path.Base(updated.Path), ".md")
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
	unlock := lockIMindNote(peer.Meta().Machine, id)
	defer unlock()
	file, _, ok := h.readIMindNote(w, r, peer, id)
	if !ok {
		return
	}
	if req.Revision != file.Revision {
		writeIMindConflict(w, file.Revision)
		return
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	if err := peer.Call(ctx, fileshare.OpDelete, map[string]string{"path": file.Path, "scope": fileshare.IMindScope, "expected_revision": req.Revision}, nil); err != nil {
		var conflict *obsidianvault.ConflictError
		if errors.As(err, &conflict) {
			writeIMindConflict(w, conflict.Revision)
			return
		}
		writeShareError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

func (h *Handler) canUseIMindShare(r *http.Request, meta fileshare.ShareMeta) bool {
	workspace := middleware.WorkspaceIDFromContext(r.Context())
	if workspace == "" || workspace != meta.WorkspaceID || requestUserID(r) == "" || !meta.Enabled {
		return false
	}
	if _, ok := middleware.MemberFromContext(r.Context()); !ok {
		return false
	}
	return meta.Visibility == fileshare.VisibilityWorkspace || h.canUseShare(r, meta)
}

func (h *Handler) iMindPeer(w http.ResponseWriter, r *http.Request, machine string) (fileshare.Peer, bool) {
	var peer fileshare.Peer
	if h.FileShares != nil {
		peer = h.FileShares.Get(machine)
	}
	if peer == nil || !h.canUseIMindShare(r, peer.Meta()) {
		writeErrorCode(w, http.StatusNotFound, "imind_share_not_found", "iMind shared knowledge base not found")
		return nil, false
	}
	if !peer.Meta().IMindScopeRevision || !peer.Meta().IMindRename || !peer.Meta().IMindMedia {
		writeErrorCode(w, http.StatusConflict, "imind_daemon_upgrade_required", "file-share daemon must be upgraded for safe iMind operations")
		return nil, false
	}
	return peer, true
}

func (h *Handler) ensureIMindDir(w http.ResponseWriter, r *http.Request, peer fileshare.Peer) bool {
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var children obsidianvault.ChildrenResult
	err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": iMindDir, "scope": fileshare.IMindScope}, &children)
	if err == nil {
		return h.syncIMindAgentInstructions(w, r, ctx, peer)
	}
	if !errors.Is(err, obsidianvault.ErrNotFound) {
		writeShareError(w, r, err)
		return false
	}
	var entry obsidianvault.Entry
	if err := peer.Call(ctx, fileshare.OpMkdir, map[string]string{"path": iMindDir, "scope": fileshare.IMindScope}, &entry); err != nil {
		if !errors.Is(err, obsidianvault.ErrExists) {
			writeShareError(w, r, err)
			return false
		}
		if err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": iMindDir, "scope": fileshare.IMindScope}, &children); err != nil {
			writeShareError(w, r, err)
			return false
		}
	}
	return h.syncIMindAgentInstructions(w, r, ctx, peer)
}

// iMindFilename produces a portable, visible filename; the note ID remains in frontmatter.
func iMindFilename(title string) string {
	var b strings.Builder
	for _, r := range title {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			b.WriteRune(' ')
			continue
		}
		if b.Len()+utf8.RuneLen(r) > 160 {
			break
		}
		b.WriteRune(r)
	}
	name := strings.Trim(strings.TrimSpace(b.String()), ". ")
	if name == "" {
		return "笔记"
	}
	return name
}

func (h *Handler) readIMindNote(w http.ResponseWriter, r *http.Request, peer fileshare.Peer, id string) (obsidianvault.FileContent, imind.Note, bool) {
	if !imind.ValidID(id) {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_note", "canonical UUID-v4 note id is required")
		return obsidianvault.FileContent{}, imind.Note{}, false
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var children obsidianvault.ChildrenResult
	if err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": iMindDir, "scope": fileshare.IMindScope}, &children); err != nil {
		writeShareError(w, r, err)
		return obsidianvault.FileContent{}, imind.Note{}, false
	}
	var found obsidianvault.FileContent
	var note imind.Note
	matched := false
	for _, node := range children.Nodes {
		if node.Type != obsidianvault.TypeFile || !strings.HasSuffix(node.Name, ".md") || node.Path != iMindDir+"/"+node.Name {
			continue
		}
		file, err := h.FileShares.ReadScoped(ctx, peer, node.Path, fileshare.IMindScope)
		if err != nil || file.Path != node.Path {
			continue
		}
		candidate, err := imind.Parse(file.Content, strings.TrimSuffix(path.Base(file.Path), ".md"))
		if err != nil || candidate.ID != id {
			continue
		}
		if matched {
			writeErrorCode(w, http.StatusConflict, "imind_duplicate_id", "multiple notes have the same id")
			return obsidianvault.FileContent{}, imind.Note{}, false
		}
		found, note, matched = file, candidate, true
	}
	if !matched {
		writeShareError(w, r, obsidianvault.ErrNotFound)
		return obsidianvault.FileContent{}, imind.Note{}, false
	}
	return found, note, true
}

func writeIMindConflict(w http.ResponseWriter, revision string) {
	writeJSON(w, http.StatusConflict, map[string]string{
		"error": "note changed since it was loaded", "code": "imind_conflict", "revision": revision,
	})
}

func decodeIMindBody(w http.ResponseWriter, r *http.Request, dest any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	raw, err := io.ReadAll(r.Body)
	if err != nil || !utf8.Valid(raw) || decodeIMindJSON(raw, dest) != nil {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_request", "invalid request body")
		return false
	}
	return true
}

func decodeIMindJSON(raw []byte, dest any) error {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' || !utf8.Valid(raw) {
		return errors.New("expected UTF-8 JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := uniqueIMindJSONValue(decoder, false); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}

func uniqueIMindJSONValue(decoder *json.Decoder, allowNull bool) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	if token == nil && !allowNull {
		return errors.New("null scalar field")
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	keys := map[string]bool{}
	for decoder.More() {
		allowNull := false
		if delim == '{' {
			token, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := token.(string)
			if !ok || keys[strings.ToLower(key)] {
				return errors.New("duplicate JSON field")
			}
			key = strings.ToLower(key)
			keys[key] = true
			allowNull = key == "audio" || key == "source_url" || key == "tags" || key == "agent_id" || key == "template"
		}
		if err := uniqueIMindJSONValue(decoder, allowNull); err != nil {
			return err
		}
	}
	_, err = decoder.Token()
	return err
}

func containsIMindTag(tags []string, needle string) bool {
	for _, tag := range tags {
		if tag == needle {
			return true
		}
	}
	return false
}

// renameIMindNote keeps every iMind naming entry point tied to the final filename.
// Callers hold lockIMindNote so suffix resolution and chat updates stay ordered.
func (h *Handler) renameIMindNote(ctx context.Context, peer fileshare.Peer, noteID, filePath, title string) (string, error) {
	base := iMindFilename(title)
	for suffix := 1; ; suffix++ {
		name := base
		if suffix > 1 {
			name += fmt.Sprintf(" (%d)", suffix)
		}
		if name+".md" != path.Base(filePath) {
			var result obsidianvault.MoveResult
			err := peer.Call(ctx, fileshare.OpRename, map[string]string{"path": filePath, "name": name + ".md", "scope": fileshare.IMindScope}, &result)
			if errors.Is(err, obsidianvault.ErrExists) {
				continue
			}
			if err != nil {
				return filePath, err
			}
			filePath = result.Path
		}
		// Also reconcile unchanged filenames after a previous chat update failed.
		err := h.syncIMindChatTitle(ctx, peer.Meta(), noteID, strings.TrimSuffix(path.Base(filePath), ".md"))
		return filePath, err
	}
}
