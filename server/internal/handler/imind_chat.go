package handler

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func (h *Handler) imindPeerByRoot(rootID string) fileshare.Peer {
	if h.FileShares == nil {
		return nil
	}
	for _, peer := range h.FileShares.List() {
		if imindShareRootID(peer.Meta()) == rootID {
			return peer
		}
	}
	return nil
}

func imindShareRootID(meta fileshare.ShareMeta) string {
	identity := meta.OwnerUserID + "\x00" + meta.DaemonID + "\x00" + filepath.Clean(meta.Dir)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(identity)))
}

type imindChatEnsureRequest struct {
	ShareMachine string `json:"share_machine"`
	NoteID       string `json:"note_id"`
	Revision     string `json:"revision"`
}

// EnsureIMindChat binds a saved note to exactly one workspace chat and joins
// the requesting member. The advisory transaction lock serializes first-open
// races across API instances; the unique key remains the durable invariant.
func (h *Handler) EnsureIMindChat(w http.ResponseWriter, r *http.Request) {
	var req imindChatEnsureRequest
	if !decodeIMindBody(w, r, &req) {
		return
	}
	peer, ok := h.iMindPeer(w, r, req.ShareMachine)
	if !ok {
		return
	}
	file, note, ok := h.readIMindNote(w, r, peer, req.NoteID)
	if !ok {
		return
	}
	if req.Revision == "" {
		writeErrorCode(w, http.StatusBadRequest, "imind_revision_required", "saved note revision is required")
		return
	}
	if req.Revision != file.Revision {
		writeIMindConflict(w, file.Revision)
		return
	}
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	noteUUID, ok := parseUUIDOrBadRequest(w, note.ID, "note_id")
	if !ok {
		return
	}
	rootID := imindShareRootID(peer.Meta())
	lockKey := fmt.Sprintf("imind:%s:%s:%s", uuidToString(member.WorkspaceID), rootID, note.ID)
	tx, err := h.beginIMindChatBinding(r.Context(), lockKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to bind note chat")
		return
	}
	defer tx.Rollback(r.Context())
	var issueID pgtype.UUID
	err = tx.QueryRow(r.Context(), `SELECT issue_id FROM imind_group_chat WHERE workspace_id=$1 AND share_root_id=$2 AND note_id=$3`, member.WorkspaceID, rootID, noteUUID).Scan(&issueID)
	if err == pgx.ErrNoRows {
		refs := []service.IssueMemberRef{{Type: "member", ID: parseUUID(userID)}}
		issue, _, created := h.createGroupChat(w, r, member, userID, "iMind · "+note.Title, refs, false, false,
			func(ctx context.Context, createTx pgx.Tx, issue db.Issue) error {
				_, err := createTx.Exec(ctx, `INSERT INTO imind_group_chat(workspace_id,share_root_id,share_machine,note_id,issue_id) VALUES($1,$2,$3,$4,$5)`, member.WorkspaceID, rootID, peer.Meta().Machine, noteUUID, issue.ID)
				return err
			})
		if !created {
			return
		}
		issueID = issue.ID
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load note chat")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to bind note chat")
		return
	}
	issue, err := h.Queries.GetIssue(r.Context(), issueID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load note chat")
		return
	}
	if err = h.Queries.AddIssueMember(r.Context(), db.AddIssueMemberParams{IssueID: issueID, WorkspaceID: member.WorkspaceID, MemberType: "member", MemberID: parseUUID(userID), AddedByType: pgtype.Text{String: "member", Valid: true}, AddedByID: parseUUID(userID)}); err != nil {
		// Existing membership is the expected idempotent case.
		if exists, e := h.Queries.IsIssueMember(r.Context(), db.IsIssueMemberParams{IssueID: issueID, MemberType: "member", MemberID: parseUUID(userID)}); e != nil || !exists {
			writeError(w, http.StatusInternalServerError, "failed to join note chat")
			return
		}
	}
	h.subscribeGroupChatMember(r.Context(), issueID, service.IssueMemberRef{Type: "member", ID: parseUUID(userID)})
	members, err := h.Queries.ListIssueMembers(r.Context(), db.ListIssueMembersParams{IssueID: issueID, WorkspaceID: member.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load note chat members")
		return
	}
	resp := groupChatToResponse(issue, h.getIssuePrefix(r.Context(), member.WorkspaceID), members, nil, userID)
	writeJSON(w, http.StatusOK, map[string]any{"issue_id": uuidToString(issueID), "identifier": resp.Identifier, "title": resp.Title, "joined": true, "chat": resp})
}

// Waiters release their connection so the lock holder can create the issue
// without starving the pool when many clients first open the same file.
func (h *Handler) beginIMindChatBinding(ctx context.Context, key string) (pgx.Tx, error) {
	for {
		tx, err := h.TxStarter.Begin(ctx)
		if err != nil {
			return nil, err
		}
		var locked bool
		err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))", key).Scan(&locked)
		if err == nil && locked {
			return tx, nil
		}
		_ = tx.Rollback(ctx)
		if err != nil {
			return nil, err
		}
		timer := time.NewTimer(20 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func (h *Handler) GetIMindDefaultAgent(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	var id pgtype.UUID
	err := h.DB.QueryRow(r.Context(), `SELECT imind_default_agent_id FROM workspace WHERE id=$1`, member.WorkspaceID).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load default agent")
		return
	}
	var value any
	if id.Valid {
		value = uuidToString(id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"agent_id": value})
}

func (h *Handler) PutIMindDefaultAgent(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "workspace admin access required")
		return
	}
	var req struct {
		AgentID *string `json:"agent_id"`
	}
	if !decodeIMindBody(w, r, &req) {
		return
	}
	var id pgtype.UUID
	if req.AgentID != nil && *req.AgentID != "" {
		parsed, valid := parseUUIDOrBadRequest(w, *req.AgentID, "agent_id")
		if !valid {
			return
		}
		agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{ID: parsed, WorkspaceID: member.WorkspaceID})
		if err != nil {
			writeError(w, http.StatusBadRequest, "agent not found in this workspace")
			return
		}
		if !h.memberCanWireAgent(r.Context(), member, agent, uuidToString(member.WorkspaceID)) {
			writeError(w, http.StatusForbidden, "you can only configure an agent you have access to")
			return
		}
		id = parsed
	}
	if _, err := h.DB.Exec(r.Context(), `UPDATE workspace SET imind_default_agent_id=$2 WHERE id=$1`, member.WorkspaceID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save default agent")
		return
	}
	var value any
	if id.Valid {
		value = uuidToString(id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"agent_id": value})
}

func (h *Handler) RetryIMindChatMessage(w http.ResponseWriter, r *http.Request) {
	issue, members, ok := h.loadGroupChat(w, r)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var req struct {
		CommentID string `json:"comment_id"`
	}
	if !decodeIMindBody(w, r, &req) {
		return
	}
	commentID, valid := parseUUIDOrBadRequest(w, req.CommentID, "comment_id")
	if !valid {
		return
	}
	if !h.isIMindChatIssue(r.Context(), issue) {
		writeError(w, http.StatusNotFound, "file chat not found")
		return
	}
	comment, err := h.Queries.GetComment(r.Context(), commentID)
	if err != nil || !sameUUID(comment.IssueID, issue.ID) || comment.DeletedAt.Valid || comment.AuthorType != "member" || uuidToString(comment.AuthorID) != userID {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if len(members) == 0 {
		writeError(w, http.StatusNotFound, "chat not found")
		return
	}
	if h.imindRunStatus(r.Context(), issue, comment) == "queued" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "queued"})
		return
	}
	h.dispatchGroupChatReply(r.Context(), issue, comment)
	tasks, err := h.Queries.ListActiveTasksByIssue(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check retry status")
		return
	}
	for _, task := range tasks {
		if task.TriggerCommentID.Valid && sameUUID(task.TriggerCommentID, comment.ID) {
			if _, err := h.DB.Exec(r.Context(), `UPDATE comment SET imind_agent_status='queued' WHERE id=$1`, comment.ID); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to save retry status")
				return
			}
			h.publish(protocol.EventIMindMessageStatus, uuidToString(issue.WorkspaceID), "system", "", map[string]any{"issue_id": uuidToString(issue.ID), "comment_id": uuidToString(comment.ID), "status": "queued"})
			writeJSON(w, http.StatusOK, map[string]string{"status": "queued"})
			return
		}
	}
	writeErrorCode(w, http.StatusServiceUnavailable, "imind_agent_unavailable", "No agent run was queued. The message remains available to retry.")
}

func (h *Handler) isIMindChatIssue(ctx context.Context, issue db.Issue) bool {
	var exists bool
	if err := h.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM imind_group_chat WHERE workspace_id=$1 AND issue_id=$2)`, issue.WorkspaceID, issue.ID).Scan(&exists); err != nil {
		return false
	}
	return exists
}

func (h *Handler) imindRunStatus(ctx context.Context, issue db.Issue, comment db.Comment) string {
	tasks, err := h.Queries.ListActiveTasksByIssue(ctx, issue.ID)
	if err != nil {
		return "unavailable"
	}
	for _, task := range tasks {
		if task.TriggerCommentID.Valid && sameUUID(task.TriggerCommentID, comment.ID) {
			return "queued"
		}
	}
	return "unavailable"
}

// FilterIMindChatAudience rechecks file permissions at event delivery, including
// connections that joined before a shared root became private or was disabled.
func (h *Handler) FilterIMindChatAudience(ctx context.Context, issueID string, users []string) []string {
	id, err := util.ParseUUID(issueID)
	if err != nil {
		return nil
	}
	var root string
	err = h.DB.QueryRow(ctx, `SELECT share_root_id FROM imind_group_chat WHERE issue_id=$1`, id).Scan(&root)
	if err == pgx.ErrNoRows {
		return users
	}
	if err != nil {
		return nil
	}
	peer := h.imindPeerByRoot(root)
	if peer == nil || !peer.Meta().Enabled {
		return nil
	}
	issue, err := h.Queries.GetIssue(ctx, id)
	if err != nil {
		return nil
	}
	if _, ok := h.iMindNoteContext(ctx, issue); !ok {
		return nil
	}
	meta := peer.Meta()
	out := make([]string, 0, len(users))
	for _, user := range users {
		uid, err := util.ParseUUID(user)
		if err != nil {
			continue
		}
		if _, err := h.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{UserID: uid, WorkspaceID: issue.WorkspaceID}); err != nil {
			continue
		}
		if meta.Visibility == fileshare.VisibilityWorkspace || meta.OwnerUserID == user {
			out = append(out, user)
		}
	}
	return out
}

// A configured default applies on every message, including existing file chats.
func (h *Handler) imindDefaultProcessor(ctx context.Context, issue db.Issue, actorID pgtype.UUID) (pgtype.UUID, bool) {
	var id pgtype.UUID
	if err := h.DB.QueryRow(ctx, `SELECT imind_default_agent_id FROM workspace WHERE id=$1`, issue.WorkspaceID).Scan(&id); err != nil {
		return pgtype.UUID{}, true
	}
	if !id.Valid {
		return id, false
	}
	agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: id, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		return pgtype.UUID{}, true
	}
	member, err := h.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{UserID: actorID, WorkspaceID: issue.WorkspaceID})
	if err != nil || !h.memberCanWireAgent(ctx, member, agent, uuidToString(issue.WorkspaceID)) {
		return pgtype.UUID{}, true
	}
	if err = h.Queries.AddIssueMember(ctx, db.AddIssueMemberParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID, MemberType: "agent", MemberID: id, AddedByType: pgtype.Text{String: "member", Valid: true}, AddedByID: actorID}); err != nil {
		return pgtype.UUID{}, true
	}
	return id, true
}
