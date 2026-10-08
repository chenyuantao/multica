package handler

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/pkg/db/generated"
)

// docsTarget is one connected machine the caller may use; rel is the path
// under its shared directory. Responses are prefixed with the machine name.
type docsTarget struct {
	rel  string
	peer fileshare.Peer
}

// resolveDocsPath maps a knowledge path to its machine. A machine that is not
// connected, or that the caller may not use, reads as not found so a private
// share's name does not leak.
func (h *Handler) resolveDocsPath(w http.ResponseWriter, r *http.Request, path string) (docsTarget, bool) {
	root, _ := fileshare.Cut(path)
	if peer := h.peerFor(r, root); peer != nil {
		_, rest := fileshare.Cut(path)
		return docsTarget{rel: rest, peer: peer}, true
	}
	// A card often stores the path inside the share and leaves off the machine
	// name. Match that path, or the same path with one other root removed.
	if path != "" {
		if peer, rel := h.matchOmittedRoot(r, path); peer != nil {
			return docsTarget{rel: rel, peer: peer}, true
		}
	}
	writeDocsVaultError(w, r, obsidianvault.ErrNotFound)
	return docsTarget{}, false
}

// matchOmittedRoot finds a visible share that contains path. The full path is
// tried first, so a real directory name is not treated as a machine. A leading
// segment is dropped only when nothing has the full path.
func (h *Handler) matchOmittedRoot(r *http.Request, path string) (fileshare.Peer, string) {
	peers := h.visiblePeers(r)
	if len(peers) == 0 {
		return nil, ""
	}
	ctx, cancel := h.shareContext(r)
	defer cancel()
	candidates := []string{path}
	if _, rest := fileshare.Cut(path); rest != "" {
		candidates = append(candidates, rest)
	}
	var found fileshare.Peer
	var rel string
	var newest time.Time
	var have bool
	for _, candidate := range candidates {
		for _, peer := range peers {
			when, ok := shareHas(ctx, peer, candidate)
			if !ok {
				continue
			}
			if !have || when.After(newest) {
				found, rel, newest, have = peer, candidate, when, true
			}
		}
		if have {
			return found, rel
		}
	}
	return nil, ""
}

func shareHas(ctx context.Context, peer fileshare.Peer, rel string) (time.Time, bool) {
	var file obsidianvault.HierarchyResult
	err := peer.Call(ctx, fileshare.OpHierarchy, map[string]string{"path": rel}, &file)
	if err == nil {
		if file.File.ModifiedAt != nil {
			if when, parseErr := time.Parse(time.RFC3339, *file.File.ModifiedAt); parseErr == nil {
				return when, true
			}
		}
		return time.Time{}, true
	}
	if !errors.Is(err, obsidianvault.ErrNotFile) {
		return time.Time{}, false
	}
	var children obsidianvault.ChildrenResult
	if err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": rel}, &children); err != nil {
		return time.Time{}, false
	}
	return time.Time{}, true
}

func (h *Handler) peerFor(r *http.Request, machine string) fileshare.Peer {
	if h.FileShares == nil || machine == "" {
		return nil
	}
	peer := h.FileShares.Get(machine)
	if peer == nil || !h.canUseShare(r, peer.Meta()) {
		return nil
	}
	return peer
}

func (h *Handler) visiblePeers(r *http.Request) []fileshare.Peer {
	if h.FileShares == nil {
		return nil
	}
	all := h.FileShares.List()
	out := make([]fileshare.Peer, 0, len(all))
	for _, peer := range all {
		if h.canUseShare(r, peer.Meta()) {
			out = append(out, peer)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Meta().Machine < out[j].Meta().Machine
	})
	return out
}

func (h *Handler) canUseShare(r *http.Request, meta fileshare.ShareMeta) bool {
	if !meta.Enabled {
		return false
	}
	userID := requestUserID(r)
	if userID != "" && userID == meta.OwnerUserID {
		return true
	}
	if h.Queries == nil {
		return false
	}
	switch meta.Visibility {
	case fileshare.VisibilityWorkspace:
		if userID != "" && h.userInWorkspace(r.Context(), userID, meta.WorkspaceID) {
			return true
		}
		return h.agentInWorkspace(r, meta.WorkspaceID)
	default:
		return h.agentOwnedBy(r, meta.OwnerUserID, meta.WorkspaceID)
	}
}

func (h *Handler) userInWorkspace(ctx context.Context, userID, workspaceID string) bool {
	uid, err := util.ParseUUID(userID)
	if err != nil {
		return false
	}
	wid, err := util.ParseUUID(workspaceID)
	if err != nil {
		return false
	}
	_, err = h.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID:      uid,
		WorkspaceID: wid,
	})
	return err == nil
}

func (h *Handler) agentInWorkspace(r *http.Request, workspaceID string) bool {
	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	if actorType != "agent" || actorID == "" {
		return false
	}
	agentID, err := util.ParseUUID(actorID)
	if err != nil {
		return false
	}
	agent, err := h.Queries.GetAgent(r.Context(), agentID)
	return err == nil && uuidToString(agent.WorkspaceID) == workspaceID
}

func (h *Handler) agentOwnedBy(r *http.Request, ownerUserID, workspaceID string) bool {
	if workspaceID == "" || ownerUserID == "" {
		return false
	}
	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	if actorType != "agent" || actorID == "" {
		return false
	}
	agentID, err := util.ParseUUID(actorID)
	if err != nil {
		return false
	}
	agent, err := h.Queries.GetAgent(r.Context(), agentID)
	if err != nil || uuidToString(agent.WorkspaceID) != workspaceID || !agent.OwnerID.Valid {
		return false
	}
	member, err := h.Queries.GetMember(r.Context(), agent.OwnerID)
	if err != nil {
		return false
	}
	return uuidToString(member.UserID) == ownerUserID
}

func (h *Handler) shareContext(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), 30*time.Second)
}

func prefixNodes(root string, nodes []obsidianvault.Node) []obsidianvault.Node {
	if nodes == nil {
		return []obsidianvault.Node{}
	}
	out := make([]obsidianvault.Node, len(nodes))
	for i, node := range nodes {
		out[i] = prefixNode(root, node)
	}
	return out
}

func prefixNode(root string, node obsidianvault.Node) obsidianvault.Node {
	node.Path = fileshare.Join(root, node.Path)
	if len(node.Children) > 0 {
		node.Children = prefixNodes(root, node.Children)
	}
	return node
}

func prefixFile(root string, file obsidianvault.FileContent) obsidianvault.FileContent {
	file.Path = fileshare.Join(root, file.Path)
	return file
}

func (h *Handler) machineLevels(r *http.Request) []obsidianvault.Node {
	peers := h.visiblePeers(r)
	ctx, cancel := h.shareContext(r)
	defer cancel()
	nodes := make([]obsidianvault.Node, 0, len(peers))
	for _, peer := range peers {
		meta := peer.Meta()
		node := obsidianvault.Node{Name: meta.Machine, Path: meta.Machine, Type: obsidianvault.TypeDir}
		var result obsidianvault.ChildrenResult
		if err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": ""}, &result); err == nil {
			kids := prefixNodes(meta.Machine, result.Nodes)
			node.ChildCount = len(kids)
			node.Children = kids
		}
		nodes = append(nodes, node)
	}
	return nodes
}

func (h *Handler) machineTrees(r *http.Request) []obsidianvault.Node {
	peers := h.visiblePeers(r)
	nodes := make([]obsidianvault.Node, len(peers))
	ctx, cancel := h.shareContext(r)
	defer cancel()
	for i, peer := range peers {
		meta := peer.Meta()
		var tree obsidianvault.TreeResult
		err := peer.Call(ctx, fileshare.OpTree, map[string]any{}, &tree)
		node := obsidianvault.Node{
			Name: meta.Machine,
			Path: meta.Machine,
			Type: obsidianvault.TypeDir,
		}
		if err == nil {
			kids := prefixNodes(meta.Machine, tree.Nodes)
			node.ChildCount = len(kids)
			node.Children = kids
		}
		nodes[i] = node
	}
	return nodes
}

func writeShareError(w http.ResponseWriter, r *http.Request, err error) {
	if r != nil && errors.Is(err, r.Context().Err()) {
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		writeErrorCode(w, http.StatusGatewayTimeout, "file_share_timeout", "the machine did not answer in time")
		return
	}
	var conflict *obsidianvault.ConflictError
	var merged *obsidianvault.MergeConflictError
	if errors.As(err, &conflict) || errors.As(err, &merged) ||
		errors.Is(err, obsidianvault.ErrInvalidPath) ||
		errors.Is(err, obsidianvault.ErrNotFound) ||
		errors.Is(err, obsidianvault.ErrNotFile) ||
		errors.Is(err, obsidianvault.ErrExists) ||
		errors.Is(err, obsidianvault.ErrNotDir) ||
		errors.Is(err, obsidianvault.ErrInvalidMove) ||
		errors.Is(err, obsidianvault.ErrQueryRequired) ||
		errors.Is(err, obsidianvault.ErrQueryTooLong) ||
		errors.Is(err, obsidianvault.ErrInvalidEdit) ||
		errors.Is(err, obsidianvault.ErrNotUTF8) ||
		errors.Is(err, obsidianvault.ErrTooLarge) {
		writeDocsVaultError(w, r, err)
		return
	}
	writeError(w, http.StatusBadGateway, "file share request failed")
}
