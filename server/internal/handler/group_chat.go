package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// A group chat is an issue with members. Its messages are the issue's
// comments, so posting and reading go through the existing comment endpoints;
// loadIssueForUser keeps non-members out of every issue-scoped route.

const groupChatListLimit = 200

type GroupChatMemberResponse struct {
	MemberType  string  `json:"member_type"`
	MemberID    string  `json:"member_id"`
	AddedByType *string `json:"added_by_type"`
	AddedByID   *string `json:"added_by_id"`
	CreatedAt   string  `json:"created_at"`
}

type GroupChatResponse struct {
	ID              string                    `json:"id"`
	WorkspaceID     string                    `json:"workspace_id"`
	Identifier      string                    `json:"identifier"`
	Title           string                    `json:"title"`
	Description     string                    `json:"description"`
	CreatorType     string                    `json:"creator_type"`
	CreatorID       string                    `json:"creator_id"`
	CreatedAt       string                    `json:"created_at"`
	LastCommentAt   *string                   `json:"last_comment_at"`
	LastMessage     *CommentResponse          `json:"last_message"`
	Members         []GroupChatMemberResponse `json:"members"`
	PendingSpeakers []string                  `json:"pending_speakers"`
}

type groupChatMemberRef struct {
	MemberType string `json:"member_type"`
	MemberID   string `json:"member_id"`
}

type CreateGroupChatRequest struct {
	Title   string               `json:"title"`
	Members []groupChatMemberRef `json:"members"`
}

func groupChatMemberToResponse(m db.IssueMember) GroupChatMemberResponse {
	return GroupChatMemberResponse{
		MemberType:  m.MemberType,
		MemberID:    uuidToString(m.MemberID),
		AddedByType: textToPtr(m.AddedByType),
		AddedByID:   uuidToPtr(m.AddedByID),
		CreatedAt:   timestampToString(m.CreatedAt),
	}
}

func groupChatToResponse(issue db.Issue, prefix string, members []db.IssueMember, last *db.Comment) GroupChatResponse {
	resp := GroupChatResponse{
		ID:              uuidToString(issue.ID),
		WorkspaceID:     uuidToString(issue.WorkspaceID),
		Identifier:      issueToResponse(issue, prefix).Identifier,
		Title:           issue.Title,
		Description:     issue.Description.String,
		CreatorType:     issue.CreatorType,
		CreatorID:       uuidToString(issue.CreatorID),
		CreatedAt:       timestampToString(issue.CreatedAt),
		LastCommentAt:   timestampToPtr(issue.LastCommentAt),
		Members:         make([]GroupChatMemberResponse, 0, len(members)),
		PendingSpeakers: []string{},
	}
	for _, m := range members {
		resp.Members = append(resp.Members, groupChatMemberToResponse(m))
	}
	if last != nil {
		msg := commentToResponse(*last, nil, nil)
		msg.Content, _ = summarizeContent(msg.Content)
		resp.LastMessage = &msg
	}
	return resp
}

// canAccessGroupChat reports whether the requester may see the issue. Issues
// without members are ordinary issues and stay visible to the whole workspace.
func (h *Handler) canAccessGroupChat(ctx context.Context, r *http.Request, issue db.Issue) (bool, error) {
	hasMembers, err := h.Queries.IssueHasMembers(ctx, issue.ID)
	if err != nil || !hasMembers {
		return !hasMembers, err
	}
	actorType, actorID := h.resolveActor(r, requestUserID(r), uuidToString(issue.WorkspaceID))
	actorUUID, err := util.ParseUUID(actorID)
	if err != nil {
		return false, nil
	}
	return h.Queries.IsIssueMember(ctx, db.IsIssueMemberParams{
		IssueID:    issue.ID,
		MemberType: actorType,
		MemberID:   actorUUID,
	})
}

// validateGroupChatMember checks that the ref names a person or an agent in
// this workspace that the acting member is allowed to bring into a chat.
func (h *Handler) validateGroupChatMember(w http.ResponseWriter, r *http.Request, member db.Member, workspaceID pgtype.UUID, ref groupChatMemberRef) (service.IssueMemberRef, bool) {
	if ref.MemberType != "member" && ref.MemberType != "agent" {
		writeError(w, http.StatusBadRequest, "member_type must be 'agent' or 'member'")
		return service.IssueMemberRef{}, false
	}
	id, ok := parseUUIDOrBadRequest(w, ref.MemberID, "member_id")
	if !ok {
		return service.IssueMemberRef{}, false
	}
	if ref.MemberType == "agent" {
		agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{ID: id, WorkspaceID: workspaceID})
		if err != nil {
			writeError(w, http.StatusBadRequest, "agent not found in this workspace")
			return service.IssueMemberRef{}, false
		}
		if !h.memberCanWireAgent(r.Context(), member, agent, uuidToString(workspaceID)) {
			writeError(w, http.StatusForbidden, "you can only add an agent you have access to")
			return service.IssueMemberRef{}, false
		}
	} else if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{UserID: id, WorkspaceID: workspaceID}); err != nil {
		writeError(w, http.StatusBadRequest, "member not found in this workspace")
		return service.IssueMemberRef{}, false
	}
	return service.IssueMemberRef{Type: ref.MemberType, ID: id}, true
}

// loadGroupChat loads a group chat the requester belongs to. Ordinary issues
// are reported as not found so this surface only ever exposes chats.
func (h *Handler) loadGroupChat(w http.ResponseWriter, r *http.Request) (db.Issue, []db.IssueMember, bool) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return db.Issue{}, nil, false
	}
	members, err := h.Queries.ListIssueMembers(r.Context(), db.ListIssueMembersParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load chat members")
		return db.Issue{}, nil, false
	}
	if len(members) == 0 {
		writeError(w, http.StatusNotFound, "chat not found")
		return db.Issue{}, nil, false
	}
	return issue, members, true
}

func isGroupChatCreator(issue db.Issue, userID string) bool {
	return issue.CreatorType == "member" && uuidToString(issue.CreatorID) == userID
}

func (h *Handler) subscribeGroupChatMember(ctx context.Context, issueID pgtype.UUID, ref service.IssueMemberRef) {
	if ref.Type != "member" {
		return
	}
	if err := h.Queries.SubscribeToIssueExplicitly(ctx, db.SubscribeToIssueExplicitlyParams{
		IssueID: issueID, UserType: "member", UserID: ref.ID, Reason: "manual",
	}); err != nil {
		slog.Warn("subscribe group chat member failed", "issue_id", uuidToString(issueID), "user_id", uuidToString(ref.ID), "error", err)
	}
}

func (h *Handler) publishGroupChatUpdated(workspaceID, actorID string, issueID pgtype.UUID) {
	h.publish(protocol.EventGroupChatUpdated, workspaceID, "member", actorID, map[string]any{
		"issue_id": uuidToString(issueID),
	})
}

func (h *Handler) ListGroupChats(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return
	}
	ctx := r.Context()
	issues, err := h.Queries.ListGroupChatsForMember(ctx, db.ListGroupChatsForMemberParams{
		WorkspaceID: wsUUID,
		MemberType:  "member",
		MemberID:    parseUUID(userID),
		RowLimit:    groupChatListLimit,
	})
	if err != nil {
		slog.Warn("list group chats failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to list chats")
		return
	}

	ids := make([]pgtype.UUID, 0, len(issues))
	for _, issue := range issues {
		ids = append(ids, issue.ID)
	}
	membersByIssue := map[string][]db.IssueMember{}
	lastByIssue := map[string]db.Comment{}
	if len(ids) > 0 {
		members, err := h.Queries.ListIssueMembersForIssues(ctx, db.ListIssueMembersForIssuesParams{WorkspaceID: wsUUID, IssueIds: ids})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load chat members")
			return
		}
		for _, m := range members {
			key := uuidToString(m.IssueID)
			membersByIssue[key] = append(membersByIssue[key], m)
		}
		latest, err := h.Queries.ListLatestCommentsForIssues(ctx, db.ListLatestCommentsForIssuesParams{WorkspaceID: wsUUID, IssueIds: ids})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load latest messages")
			return
		}
		for _, c := range latest {
			lastByIssue[uuidToString(c.IssueID)] = c
		}
	}

	prefix := h.getIssuePrefix(ctx, wsUUID)
	pending := h.pendingSpeakersByIssue(ctx, ids)
	out := make([]GroupChatResponse, 0, len(issues))
	for _, issue := range issues {
		key := uuidToString(issue.ID)
		var last *db.Comment
		if c, found := lastByIssue[key]; found {
			last = &c
		}
		resp := groupChatToResponse(issue, prefix, membersByIssue[key], last)
		if speakers := pending[key]; len(speakers) > 0 {
			resp.PendingSpeakers = speakers
		}
		out = append(out, resp)
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": out})
}

func (h *Handler) GetGroupChat(w http.ResponseWriter, r *http.Request) {
	issue, members, ok := h.loadGroupChat(w, r)
	if !ok {
		return
	}
	var last *db.Comment
	latest, err := h.Queries.ListLatestCommentsForIssues(r.Context(), db.ListLatestCommentsForIssuesParams{
		WorkspaceID: issue.WorkspaceID, IssueIds: []pgtype.UUID{issue.ID},
	})
	if err == nil && len(latest) > 0 {
		last = &latest[0]
	}
	resp := groupChatToResponse(issue, h.getIssuePrefix(r.Context(), issue.WorkspaceID), members, last)
	if speakers := h.pendingSpeakersByIssue(r.Context(), []pgtype.UUID{issue.ID})[uuidToString(issue.ID)]; len(speakers) > 0 {
		resp.PendingSpeakers = speakers
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateGroupChat(w http.ResponseWriter, r *http.Request) {
	r = h.withWakeupActor(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	var req CreateGroupChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Title = sanitizeNullBytes(req.Title)
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	creator := service.IssueMemberRef{Type: "member", ID: parseUUID(userID)}
	refs := []service.IssueMemberRef{creator}
	seen := map[string]struct{}{creator.Type + ":" + userID: {}}
	for _, raw := range req.Members {
		ref, ok := h.validateGroupChatMember(w, r, member, member.WorkspaceID, raw)
		if !ok {
			return
		}
		key := ref.Type + ":" + uuidToString(ref.ID)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		refs = append(refs, ref)
	}

	prefix := h.getIssuePrefix(r.Context(), member.WorkspaceID)
	res, err := h.IssueService.Create(r.Context(), service.IssueCreateParams{
		WorkspaceID:    member.WorkspaceID,
		Title:          req.Title,
		Status:         "todo",
		Priority:       "none",
		CreatorType:    "member",
		CreatorID:      creator.ID,
		AllowDuplicate: true,
		Members:        refs,
	}, service.IssueCreateOpts{
		ActorID:  userID,
		Platform: func() string { p, _, _ := middleware.ClientMetadataFromContext(r.Context()); return p }(),
		BroadcastPayload: func(issue db.Issue, _ []db.Attachment, _ []db.IssueLabel) map[string]any {
			return map[string]any{"issue": issueToResponse(issue, prefix)}
		},
	})
	if writeIssueLimitReached(w, err) {
		return
	}
	if err != nil {
		slog.Warn("create group chat failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create chat")
		return
	}
	for _, ref := range refs {
		h.subscribeGroupChatMember(r.Context(), res.Issue.ID, ref)
	}

	members, err := h.Queries.ListIssueMembers(r.Context(), db.ListIssueMembersParams{IssueID: res.Issue.ID, WorkspaceID: res.Issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load chat members")
		return
	}
	h.publishGroupChatUpdated(uuidToString(member.WorkspaceID), userID, res.Issue.ID)
	writeJSON(w, http.StatusCreated, groupChatToResponse(res.Issue, prefix, members, nil))
}

// UpdateGroupChatRequest patches the chat name and its announcement, which is
// the underlying issue's description. Omitted fields stay unchanged.
type UpdateGroupChatRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

// UpdateGroupChat renames a chat or edits its announcement. Any chat member
// may do either; membership changes stay creator-only.
func (h *Handler) UpdateGroupChat(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	issue, members, ok := h.loadGroupChat(w, r)
	if !ok {
		return
	}
	var req UpdateGroupChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Title == nil && req.Description == nil {
		writeError(w, http.StatusBadRequest, "title or description is required")
		return
	}
	var patch service.IssueContentPatch
	if req.Title != nil {
		title := strings.TrimSpace(sanitizeNullBytes(*req.Title))
		if title == "" {
			writeError(w, http.StatusBadRequest, "title is required")
			return
		}
		if title != issue.Title {
			patch.Title = &title
		}
	}
	if req.Description != nil {
		description := sanitizeNullBytes(*req.Description)
		if description != issue.Description.String {
			patch.Description = &description
		}
	}
	if patch.Title != nil || patch.Description != nil {
		updated, err := h.IssueService.UpdateContent(r.Context(), issue, patch)
		if err != nil {
			slog.Warn("update group chat failed", append(logger.RequestAttrs(r), "error", err)...)
			writeError(w, http.StatusInternalServerError, "failed to update chat")
			return
		}
		issue = updated
		h.publishGroupChatUpdated(uuidToString(issue.WorkspaceID), userID, issue.ID)
	}
	writeJSON(w, http.StatusOK, groupChatToResponse(issue, h.getIssuePrefix(r.Context(), issue.WorkspaceID), members, nil))
}

func (h *Handler) AddGroupChatMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	issue, _, ok := h.loadGroupChat(w, r)
	if !ok {
		return
	}
	if !isGroupChatCreator(issue, userID) {
		writeError(w, http.StatusForbidden, "only the chat creator can manage members")
		return
	}
	var req groupChatMemberRef
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ref, ok := h.validateGroupChatMember(w, r, member, issue.WorkspaceID, req)
	if !ok {
		return
	}
	if err := h.Queries.AddIssueMember(r.Context(), db.AddIssueMemberParams{
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		MemberType:  ref.Type,
		MemberID:    ref.ID,
		AddedByType: pgtype.Text{String: "member", Valid: true},
		AddedByID:   parseUUID(userID),
	}); err != nil {
		slog.Warn("add group chat member failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to add member")
		return
	}
	h.subscribeGroupChatMember(r.Context(), issue.ID, ref)

	members, err := h.Queries.ListIssueMembers(r.Context(), db.ListIssueMembersParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load chat members")
		return
	}
	h.publishGroupChatUpdated(uuidToString(issue.WorkspaceID), userID, issue.ID)
	writeJSON(w, http.StatusOK, groupChatToResponse(issue, h.getIssuePrefix(r.Context(), issue.WorkspaceID), members, nil))
}

func (h *Handler) RemoveGroupChatMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	issue, _, ok := h.loadGroupChat(w, r)
	if !ok {
		return
	}
	if !isGroupChatCreator(issue, userID) {
		writeError(w, http.StatusForbidden, "only the chat creator can manage members")
		return
	}
	memberType := chi.URLParam(r, "memberType")
	if memberType != "member" && memberType != "agent" {
		writeError(w, http.StatusBadRequest, "member_type must be 'agent' or 'member'")
		return
	}
	memberID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "memberId"), "member_id")
	if !ok {
		return
	}
	if memberType == "member" && uuidToString(memberID) == userID {
		writeError(w, http.StatusBadRequest, "the chat creator cannot be removed")
		return
	}
	removed, err := h.Queries.RemoveIssueMember(r.Context(), db.RemoveIssueMemberParams{
		IssueID: issue.ID, WorkspaceID: issue.WorkspaceID, MemberType: memberType, MemberID: memberID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}
	if removed == 0 {
		writeError(w, http.StatusNotFound, "member not in chat")
		return
	}
	if memberType == "member" {
		if err := h.Queries.RemoveIssueSubscriber(r.Context(), db.RemoveIssueSubscriberParams{
			IssueID: issue.ID, UserType: "member", UserID: memberID,
		}); err != nil {
			slog.Warn("unsubscribe removed group chat member failed", append(logger.RequestAttrs(r), "error", err)...)
		}
	}
	// The removed person is no longer a recipient of chat-scoped events, so
	// tell them directly that their chat list changed.
	h.publishGroupChatUpdated(uuidToString(issue.WorkspaceID), userID, issue.ID)
	if memberType == "member" {
		h.publish(protocol.EventGroupChatUpdated, uuidToString(issue.WorkspaceID), "member", userID, map[string]any{
			"issue_id":     uuidToString(issue.ID),
			"recipient_id": uuidToString(memberID),
		})
	}
	w.WriteHeader(http.StatusNoContent)
}

// rejectNonMemberAgentMentions refuses a group chat message that @mentions an
// agent or squad outside the chat: the mention would start a run that cannot
// read the chat it was asked about.
func (h *Handler) rejectNonMemberAgentMentions(w http.ResponseWriter, r *http.Request, issue db.Issue, content string) bool {
	hasMembers, err := h.Queries.IssueHasMembers(r.Context(), issue.ID)
	if err != nil || !hasMembers {
		return false
	}
	for _, m := range util.ParseMentions(content) {
		switch m.Type {
		case "squad":
			writeError(w, http.StatusBadRequest, "squads cannot be mentioned in a group chat; add its agents as members instead")
			return true
		case "agent":
			id, err := util.ParseUUID(m.ID)
			if err != nil {
				continue
			}
			isMember, err := h.Queries.IsIssueMember(r.Context(), db.IsIssueMemberParams{IssueID: issue.ID, MemberType: "agent", MemberID: id})
			if err != nil || !isMember {
				writeError(w, http.StatusBadRequest, "only agents in this chat can be mentioned")
				return true
			}
		}
	}
	return false
}
