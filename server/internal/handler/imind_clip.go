package handler

import (
	"context"
	"path"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// The saved placeholder remains the source of identity and retry context.
func (h *Handler) imindClipNote(ctx context.Context, issue db.Issue) (imind.Note, bool) {
	var rootID string
	var noteID pgtype.UUID
	if err := h.DB.QueryRow(ctx, `SELECT share_root_id,note_id FROM imind_group_chat WHERE workspace_id=$1 AND issue_id=$2`, issue.WorkspaceID, issue.ID).Scan(&rootID, &noteID); err != nil {
		return imind.Note{}, false
	}
	peer := h.imindPeerByRoot(rootID)
	if peer == nil || !peer.Meta().Enabled || peer.Meta().WorkspaceID != uuidToString(issue.WorkspaceID) {
		return imind.Note{}, false
	}
	var children obsidianvault.ChildrenResult
	if err := peer.Call(ctx, fileshare.OpChildren, map[string]string{"path": iMindDir, "scope": fileshare.IMindScope}, &children); err != nil {
		return imind.Note{}, false
	}
	for _, node := range children.Nodes {
		if node.Type != obsidianvault.TypeFile || !strings.HasSuffix(node.Name, ".md") || node.Path != iMindDir+"/"+node.Name {
			continue
		}
		file, err := h.FileShares.ReadScoped(ctx, peer, node.Path, fileshare.IMindScope)
		if err != nil || file.Path != node.Path {
			continue
		}
		note, err := imind.Parse(file.Content, strings.TrimSuffix(path.Base(file.Path), ".md"))
		if err == nil && note.ID == uuidToString(noteID) {
			return note, note.Type == "clip"
		}
	}
	return imind.Note{}, false
}

func (h *Handler) joinIMindClipAgent(ctx context.Context, issue db.Issue, actorID, agentID pgtype.UUID) bool {
	agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: agentID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		return false
	}
	actor, err := h.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{UserID: actorID, WorkspaceID: issue.WorkspaceID})
	if err != nil || !h.memberCanWireAgent(ctx, actor, agent, uuidToString(issue.WorkspaceID)) {
		return false
	}
	if err := h.Queries.AddIssueMember(ctx, db.AddIssueMemberParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID, MemberType: "agent", MemberID: agentID, AddedByType: pgtype.Text{String: "member", Valid: true}, AddedByID: actorID}); err != nil {
		return false
	}
	return true
}

func (h *Handler) joinIMindClipConfiguredAgents(ctx context.Context, issue db.Issue, actorID pgtype.UUID) {
	h.imindDefaultProcessor(ctx, issue, actorID)
	var id pgtype.UUID
	if err := h.DB.QueryRow(ctx, `SELECT imind_clip_agent_id FROM workspace WHERE id=$1`, issue.WorkspaceID).Scan(&id); err == nil && id.Valid {
		h.joinIMindClipAgent(ctx, issue, actorID, id)
	}
}

// Clipping is dispatched through the existing run scheduler, with the general
// processor present as a chat member rather than a competing clipping run.
func (h *Handler) dispatchIMindClip(ctx context.Context, issue db.Issue, comment db.Comment) bool {
	if _, clip := h.imindClipNote(ctx, issue); !clip {
		return false
	}
	defaultID, configured := h.imindDefaultProcessor(ctx, issue, comment.AuthorID)
	if configured && !defaultID.Valid {
		return true
	}
	var id pgtype.UUID
	if err := h.DB.QueryRow(ctx, `SELECT imind_clip_agent_id FROM workspace WHERE id=$1`, issue.WorkspaceID).Scan(&id); err != nil {
		return true
	}
	if !id.Valid {
		actor, err := h.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{UserID: comment.AuthorID, WorkspaceID: issue.WorkspaceID})
		if err != nil {
			return true
		}
		agents, err := h.Queries.ListAgents(ctx, issue.WorkspaceID)
		if err != nil {
			return true
		}
		state := groupchat.AskState{Query: comment.Content, Agents: []groupchat.AskAgent{}}
		for _, candidate := range agents {
			if h.memberCanWireAgent(ctx, actor, candidate, uuidToString(issue.WorkspaceID)) {
				state.Agents = append(state.Agents, groupchat.AskAgent{ID: uuidToString(candidate.ID), Name: candidate.Name, Description: candidate.Description})
			}
		}
		chosen, err := groupchat.ChooseAnswerer(ctx, h.groupChatEvaluator(issue.WorkspaceID), state)
		if err != nil {
			return true
		}
		id, err = util.ParseUUID(chosen)
		if err != nil {
			return true
		}
	}
	if !h.joinIMindClipAgent(ctx, issue, comment.AuthorID, id) {
		return true
	}
	h.enqueueGroupChatPlan(ctx, issue, comment.ID, groupchat.Plan{Mode: groupchat.ModeSingle, AgentIDs: []string{uuidToString(id)}})
	return true
}
