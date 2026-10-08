package fileshare

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

// ShareMeta is what the server remembers about a share. Dir is the absolute
// path reported by the machine, shown in the runtime UI and never written back.
type ShareMeta struct {
	Machine     string
	OwnerUserID string
	WorkspaceID string
	Visibility  string
	Dir         string
	Enabled     bool
	Online      bool
}

// AccessPatch is a runtime-UI change. Nil fields stay as they are. Dir is not
// part of the patch; the machine owns the path.
type AccessPatch struct {
	Visibility *string
	Enabled    *bool
}

// Peer is one connected machine. Call runs a single operation there.
type Peer interface {
	Meta() ShareMeta
	Call(ctx context.Context, op string, payload any, dest any) error
}

// Hub tracks the machines currently connected and remembers small unchanged
// notes so a repeat open does not pull the body across the network again.
type shareSlot struct {
	meta    ShareMeta
	peer    Peer
	pending AccessPatch
}

type Hub struct {
	mu    sync.Mutex
	slots map[string]*shareSlot
	cache *contentCache
}

func NewHub() *Hub {
	return &Hub{
		slots: map[string]*shareSlot{},
		cache: newContentCache(16),
	}
}

// Register adds a machine. The same owner reconnecting replaces the previous
// session. A different owner cannot take a name that is already remembered.
// A pending access change from the runtime UI wins over the daemon's hello,
// and the path always comes from the machine.
func (h *Hub) Register(peer Peer) error {
	meta := peer.Meta()
	name, err := SanitizeMachine(meta.Machine)
	if err != nil {
		return err
	}
	meta.Machine = name
	meta.Online = true
	h.mu.Lock()
	defer h.mu.Unlock()
	if prev, ok := h.slots[name]; ok && prev.meta.OwnerUserID != meta.OwnerUserID {
		return ErrMachineTaken
	}
	slot := h.slots[name]
	if slot != nil && slot.peer != nil && slot.peer != peer {
		if closer, ok := slot.peer.(interface{ Close() }); ok {
			closer.Close()
		}
	}
	if slot == nil {
		slot = &shareSlot{}
		h.slots[name] = slot
	}
	if slot.pending.Visibility != nil {
		meta.Visibility = *slot.pending.Visibility
	}
	if slot.pending.Enabled != nil {
		meta.Enabled = *slot.pending.Enabled
	}
	applyAccess(peer, meta.Visibility, meta.Enabled)
	meta.Dir = peer.Meta().Dir
	if meta.Dir == "" {
		meta.Dir = slot.meta.Dir
	}
	slot.meta = meta
	slot.peer = peer
	return nil
}

// Unregister marks a share offline when its socket drops. The path and access
// settings stay so the runtime page can still show them.
func (h *Hub) Unregister(peer Peer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	name, err := SanitizeMachine(peer.Meta().Machine)
	if err != nil {
		name = peer.Meta().Machine
	}
	slot := h.slots[name]
	if slot == nil || slot.peer != peer {
		return
	}
	slot.peer = nil
	slot.meta.Online = false
	h.cache.dropMachine(name)
}

// Get returns a machine that is connected and whose remote access is on.
func (h *Hub) Get(machine string) Peer {
	slot := h.slot(machine)
	if slot == nil || slot.peer == nil || !slot.meta.Enabled {
		return nil
	}
	return slot.peer
}

// Known reports whether this process has seen the machine, including offline
// and disabled shares.
func (h *Hub) Known(machine string) bool {
	return h.slot(machine) != nil
}

func (h *Hub) List() []Peer {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]Peer, 0, len(h.slots))
	for _, slot := range h.slots {
		if slot.peer != nil && slot.meta.Enabled {
			out = append(out, slot.peer)
		}
	}
	return out
}

// Records lists shares owned by userID in one workspace, online or not.
func (h *Hub) Records(ownerUserID, workspaceID string) []ShareMeta {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]ShareMeta, 0, len(h.slots))
	for _, slot := range h.slots {
		if slot.meta.OwnerUserID != ownerUserID || slot.meta.WorkspaceID != workspaceID {
			continue
		}
		out = append(out, slot.meta)
	}
	return out
}

// UpdateAccess changes visibility or the remote-access switch. The directory
// is left untouched. A connected daemon is told immediately; an offline one
// receives the change the next time it says hello.
func (h *Hub) UpdateAccess(ownerUserID, machine string, patch AccessPatch) (ShareMeta, error) {
	name, err := SanitizeMachine(machine)
	if err != nil {
		return ShareMeta{}, err
	}
	h.mu.Lock()
	slot := h.slots[name]
	if slot == nil || slot.meta.OwnerUserID != ownerUserID {
		h.mu.Unlock()
		return ShareMeta{}, obsidianvault.ErrNotFound
	}
	if patch.Visibility != nil {
		visibility, err := NormalizeVisibility(*patch.Visibility)
		if err != nil {
			h.mu.Unlock()
			return ShareMeta{}, err
		}
		if visibility == VisibilityWorkspace && slot.meta.WorkspaceID == "" {
			h.mu.Unlock()
			return ShareMeta{}, errBadVisibility
		}
		slot.meta.Visibility = visibility
		slot.pending.Visibility = &visibility
	}
	if patch.Enabled != nil {
		slot.meta.Enabled = *patch.Enabled
		enabled := *patch.Enabled
		slot.pending.Enabled = &enabled
	}
	meta := slot.meta
	peer := slot.peer
	h.mu.Unlock()
	if peer != nil {
		applyAccess(peer, meta.Visibility, meta.Enabled)
		if pusher, ok := peer.(interface {
			PushAccess(visibility string, enabled bool) error
		}); ok {
			if err := pusher.PushAccess(meta.Visibility, meta.Enabled); err != nil {
				return meta, nil
			}
		}
		h.mu.Lock()
		if current := h.slots[name]; current != nil && current.peer == peer {
			current.pending = AccessPatch{}
		}
		h.mu.Unlock()
	}
	return meta, nil
}

func (h *Hub) slot(machine string) *shareSlot {
	name, err := SanitizeMachine(machine)
	if err != nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.slots[name]
}

func applyAccess(peer Peer, visibility string, enabled bool) {
	setter, ok := peer.(interface {
		SetAccess(visibility string, enabled bool)
	})
	if !ok {
		return
	}
	setter.SetAccess(visibility, enabled)
}

// Read loads one note. When the cached revision still matches, the machine
// answers without the file body.
func (h *Hub) Read(ctx context.Context, peer Peer, rel string) (obsidianvault.FileContent, error) {
	machine := peer.Meta().Machine
	cached, ok := h.cache.get(machine, rel)
	req := readPayload{Path: rel}
	if ok {
		req.IfRevision = cached.Revision
	}
	var out ReadResult
	if err := peer.Call(ctx, OpRead, req, &out); err != nil {
		return obsidianvault.FileContent{}, err
	}
	if out.NotModified {
		if ok {
			return cached, nil
		}
		req.IfRevision = ""
		if err := peer.Call(ctx, OpRead, req, &out); err != nil {
			return obsidianvault.FileContent{}, err
		}
	}
	h.cache.put(machine, rel, out.FileContent)
	return out.FileContent, nil
}

// Invalidate drops cached notes for a machine after a write, create, or move.
func (h *Hub) Invalidate(machine string) {
	h.cache.dropMachine(machine)
}

// Local is a peer backed by a directory in this process. Tests use it, and
// the CLI's websocket loop uses Exec directly.
type Local struct {
	meta ShareMeta
	root string
}

func NewLocal(meta ShareMeta, root string) *Local {
	return &Local{meta: meta, root: root}
}

func (p *Local) Meta() ShareMeta { return p.meta }

func (p *Local) SetAccess(visibility string, enabled bool) {
	p.meta.Visibility = visibility
	p.meta.Enabled = enabled
}

func (p *Local) Call(ctx context.Context, op string, payload any, dest any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	result, err := Exec(ctx, p.root, op, raw)
	if err != nil {
		return err
	}
	if dest == nil {
		return nil
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, dest)
}

type cachedNote struct {
	machine string
	path    string
	file    obsidianvault.FileContent
}

// contentCache is a small ring of notes. Large notes are not stored: copying
// them again costs less than holding every opened file in the server.
type contentCache struct {
	mu    sync.Mutex
	max   int
	order []string
	items map[string]cachedNote
}

func newContentCache(max int) *contentCache {
	if max < 1 {
		max = 1
	}
	return &contentCache{max: max, items: map[string]cachedNote{}}
}

func cacheKey(machine, path string) string {
	return machine + "\x00" + path
}

func (c *contentCache) get(machine, path string) (obsidianvault.FileContent, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	item, ok := c.items[cacheKey(machine, path)]
	if !ok {
		return obsidianvault.FileContent{}, false
	}
	return item.file, true
}

func (c *contentCache) put(machine, path string, file obsidianvault.FileContent) {
	if len(file.Content) > 256*1024 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	key := cacheKey(machine, path)
	if _, ok := c.items[key]; !ok {
		c.order = append(c.order, key)
	}
	c.items[key] = cachedNote{machine: machine, path: path, file: file}
	for len(c.order) > c.max {
		drop := c.order[0]
		c.order = c.order[1:]
		delete(c.items, drop)
	}
}

func (c *contentCache) dropMachine(machine string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	kept := c.order[:0]
	for _, key := range c.order {
		item, ok := c.items[key]
		if ok && item.machine == machine {
			delete(c.items, key)
			continue
		}
		kept = append(kept, key)
	}
	c.order = kept
}
