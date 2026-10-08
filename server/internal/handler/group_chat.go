package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
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
	// A two-person chat created for one peer; its members never change.
	IsDirect bool `json:"is_direct"`
	// Messages the requester has not read yet, derived from their inbox rows.
	UnreadCount int64 `json:"unread_count"`
	// The requester pinned this chat to the top of their own list.
	Pinned bool `json:"pinned"`
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

func groupChatToResponse(issue db.Issue, prefix string, members []db.IssueMember, last *db.Comment, userID string) GroupChatResponse {
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
		IsDirect:        issue.IsDirectChat,
	}
	for _, m := range members {
		resp.Members = append(resp.Members, groupChatMemberToResponse(m))
		if m.MemberType == "member" && uuidToString(m.MemberID) == userID {
			resp.Pinned = m.PinnedAt.Valid
		}
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
	unread := h.groupChatUnreadCounts(ctx, wsUUID, parseUUID(userID), ids)
	kept := keptDirectChats(issues, membersByIssue, userID)
	out := make([]GroupChatResponse, 0, len(issues))
	for _, issue := range issues {
		key := uuidToString(issue.ID)
		if issue.IsDirectChat && !kept[key] {
			continue
		}
		var last *db.Comment
		if c, found := lastByIssue[key]; found {
			last = &c
		}
		resp := groupChatToResponse(issue, prefix, membersByIssue[key], last, userID)
		if speakers := pending[key]; len(speakers) > 0 {
			resp.PendingSpeakers = speakers
		}
		resp.UnreadCount = unread[key]
		out = append(out, resp)
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": out})
}

const groupChatSearchMaxRunes = 100

type GroupChatSearchHit struct {
	ChatID    string `json:"chat_id"`
	MessageID string `json:"message_id"`
	// Snippet of the newest matching message, centered on the keyword.
	Snippet   string `json:"snippet"`
	MessageAt string `json:"message_at"`
	// Messages in the chat that contain the keyword.
	HitCount int64 `json:"hit_count"`
}

// SearchGroupChats finds messages containing q across the requester's chats
// and returns one hit per chat. Title matching and ranking stay with the
// client, which knows the name a direct chat is shown under.
func (h *Handler) SearchGroupChats(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, "q is required")
		return
	}
	if utf8.RuneCountInString(q) > groupChatSearchMaxRunes {
		writeError(w, http.StatusBadRequest, "q is too long")
		return
	}
	rows, err := h.Queries.SearchGroupChatMessages(r.Context(), db.SearchGroupChatMessagesParams{
		MemberID:    parseUUID(userID),
		WorkspaceID: wsUUID,
		Pattern:     "%" + escapeLike(strings.ToLower(q)) + "%",
	})
	if err != nil {
		slog.Warn("search group chats failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to search chats")
		return
	}
	hits := make([]GroupChatSearchHit, 0, len(rows))
	for _, row := range rows {
		hits = append(hits, GroupChatSearchHit{
			ChatID:    uuidToString(row.IssueID),
			MessageID: uuidToString(row.CommentID),
			Snippet:   extractSnippet(row.Content, q),
			MessageAt: timestampToString(row.CreatedAt),
			HitCount:  row.HitCount,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"query": q, "hits": hits})
}

// keptDirectChats picks, per peer, the direct chat the requester sees: the
// oldest one, which is also the one opening a direct chat returns. Newer ones
// can only come from two concurrent opens and stay out of the list.
func keptDirectChats(issues []db.Issue, membersByIssue map[string][]db.IssueMember, userID string) map[string]bool {
	oldest := map[string]db.Issue{}
	for _, issue := range issues {
		if !issue.IsDirectChat {
			continue
		}
		peer := ""
		for _, m := range membersByIssue[uuidToString(issue.ID)] {
			if m.MemberType != "member" || uuidToString(m.MemberID) != userID {
				peer = m.MemberType + ":" + uuidToString(m.MemberID)
			}
		}
		cur, seen := oldest[peer]
		if !seen || issue.CreatedAt.Time.Before(cur.CreatedAt.Time) ||
			(issue.CreatedAt.Time.Equal(cur.CreatedAt.Time) && uuidToString(issue.ID) < uuidToString(cur.ID)) {
			oldest[peer] = issue
		}
	}
	kept := make(map[string]bool, len(oldest))
	for _, issue := range oldest {
		kept[uuidToString(issue.ID)] = true
	}
	return kept
}

func (h *Handler) GetGroupChat(w http.ResponseWriter, r *http.Request) {
	issue, members, ok := h.loadGroupChat(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, h.groupChatDetail(r.Context(), issue, members, requestUserID(r)))
}

// groupChatDetail is one chat with its latest message, pending speakers and
// the requester's unread count.
func (h *Handler) groupChatDetail(ctx context.Context, issue db.Issue, members []db.IssueMember, userID string) GroupChatResponse {
	var last *db.Comment
	latest, err := h.Queries.ListLatestCommentsForIssues(ctx, db.ListLatestCommentsForIssuesParams{
		WorkspaceID: issue.WorkspaceID, IssueIds: []pgtype.UUID{issue.ID},
	})
	if err == nil && len(latest) > 0 {
		last = &latest[0]
	}
	resp := groupChatToResponse(issue, h.getIssuePrefix(ctx, issue.WorkspaceID), members, last, userID)
	if speakers := h.pendingSpeakersByIssue(ctx, []pgtype.UUID{issue.ID})[uuidToString(issue.ID)]; len(speakers) > 0 {
		resp.PendingSpeakers = speakers
	}
	if userID != "" {
		resp.UnreadCount = h.groupChatUnreadCounts(ctx, issue.WorkspaceID, parseUUID(userID), []pgtype.UUID{issue.ID})[uuidToString(issue.ID)]
	}
	return resp
}

// groupChatUnreadCounts maps chat id to the requester's unread message count.
// A failed lookup degrades to no badges rather than failing the chat list.
func (h *Handler) groupChatUnreadCounts(ctx context.Context, workspaceID, recipientID pgtype.UUID, ids []pgtype.UUID) map[string]int64 {
	out := map[string]int64{}
	if len(ids) == 0 {
		return out
	}
	rows, err := h.Queries.CountUnreadGroupChatMessages(ctx, db.CountUnreadGroupChatMessagesParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		IssueIds:    ids,
	})
	if err != nil {
		slog.Warn("count group chat unread failed", "workspace_id", uuidToString(workspaceID), "error", err)
		return out
	}
	for _, row := range rows {
		out[uuidToString(row.IssueID)] = row.UnreadCount
	}
	return out
}

// MarkGroupChatRead reads every inbox notification the requester has for the
// chat, so opening a chat clears all of its unread messages at once.
func (h *Handler) MarkGroupChatRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	issue, _, ok := h.loadGroupChat(w, r)
	if !ok {
		return
	}
	count, err := h.Queries.MarkInboxReadByIssue(r.Context(), db.MarkInboxReadByIssueParams{
		WorkspaceID:   issue.WorkspaceID,
		RecipientType: "member",
		RecipientID:   parseUUID(userID),
		IssueID:       issue.ID,
	})
	if err != nil {
		slog.Warn("mark group chat read failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to mark chat read")
		return
	}
	if count > 0 {
		h.publish(protocol.EventInboxBatchRead, uuidToString(issue.WorkspaceID), "member", userID, map[string]any{
			"recipient_id": userID,
			"count":        count,
			"issue_id":     uuidToString(issue.ID),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"count": count})
}

type SetGroupChatPinnedRequest struct {
	Pinned *bool `json:"pinned"`
}

// SetGroupChatPinned pins or unpins a chat in the requester's own list. Other
// members' lists are unaffected, so only the requester's clients are told.
func (h *Handler) SetGroupChatPinned(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	issue, _, ok := h.loadGroupChat(w, r)
	if !ok {
		return
	}
	var req SetGroupChatPinnedRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Pinned == nil {
		writeError(w, http.StatusBadRequest, "pinned is required")
		return
	}
	updated, err := h.Queries.SetIssueMemberPinned(r.Context(), db.SetIssueMemberPinnedParams{
		Pinned:      *req.Pinned,
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		MemberType:  "member",
		MemberID:    parseUUID(userID),
	})
	if err != nil {
		slog.Warn("set group chat pinned failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to pin chat")
		return
	}
	if updated == 0 {
		writeError(w, http.StatusNotFound, "chat not found")
		return
	}
	members, err := h.Queries.ListIssueMembers(r.Context(), db.ListIssueMembersParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load chat members")
		return
	}
	h.publish(protocol.EventGroupChatUpdated, uuidToString(issue.WorkspaceID), "member", userID, map[string]any{
		"issue_id":     uuidToString(issue.ID),
		"recipient_id": userID,
	})
	writeJSON(w, http.StatusOK, h.groupChatDetail(r.Context(), issue, members, userID))
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

	h.createGroupChat(w, r, member, userID, req.Title, refs, false)
}

// createGroupChat creates the chat with refs as its members (the creator
// first) and writes it as the 201 response.
func (h *Handler) createGroupChat(w http.ResponseWriter, r *http.Request, member db.Member, userID, title string, refs []service.IssueMemberRef, direct bool) {
	prefix := h.getIssuePrefix(r.Context(), member.WorkspaceID)
	res, err := h.IssueService.Create(r.Context(), service.IssueCreateParams{
		WorkspaceID:    member.WorkspaceID,
		Title:          title,
		Status:         "todo",
		Priority:       "none",
		CreatorType:    "member",
		CreatorID:      refs[0].ID,
		AllowDuplicate: true,
		Members:        refs,
		DirectChat:     direct,
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
	writeJSON(w, http.StatusCreated, groupChatToResponse(res.Issue, prefix, members, nil, userID))
}

// OpenDirectGroupChat returns the requester's two-person chat with a person
// or agent, creating it only when none exists yet. The new chat is named
// after the peer; clients show the peer rather than the stored title.
func (h *Handler) OpenDirectGroupChat(w http.ResponseWriter, r *http.Request) {
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
	var req groupChatMemberRef
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	peer, ok := h.validateGroupChatMember(w, r, member, member.WorkspaceID, req)
	if !ok {
		return
	}
	if peer.Type == "member" && uuidToString(peer.ID) == userID {
		writeError(w, http.StatusBadRequest, "cannot start a direct chat with yourself")
		return
	}

	ctx := r.Context()
	existing, err := h.Queries.FindDirectGroupChat(ctx, db.FindDirectGroupChatParams{
		WorkspaceID: member.WorkspaceID,
		UserID:      parseUUID(userID),
		PeerType:    peer.Type,
		PeerID:      peer.ID,
	})
	if err == nil {
		members, err := h.Queries.ListIssueMembers(ctx, db.ListIssueMembersParams{IssueID: existing.ID, WorkspaceID: existing.WorkspaceID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load chat members")
			return
		}
		writeJSON(w, http.StatusOK, h.groupChatDetail(ctx, existing, members, userID))
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		slog.Warn("find direct group chat failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to open chat")
		return
	}

	var title string
	if peer.Type == "agent" {
		agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: peer.ID, WorkspaceID: member.WorkspaceID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load agent")
			return
		}
		title = agent.Name
	} else {
		user, err := h.Queries.GetUser(ctx, peer.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load member")
			return
		}
		title = user.Name
	}
	if strings.TrimSpace(title) == "" {
		title = "Direct chat"
	}
	creator := service.IssueMemberRef{Type: "member", ID: parseUUID(userID)}
	h.createGroupChat(w, r, member, userID, title, []service.IssueMemberRef{creator, peer}, true)
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
	writeJSON(w, http.StatusOK, groupChatToResponse(issue, h.getIssuePrefix(r.Context(), issue.WorkspaceID), members, nil, userID))
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
	if issue.IsDirectChat {
		writeError(w, http.StatusBadRequest, "members of a direct chat cannot change")
		return
	}
	if isReminder(issue) {
		writeError(w, http.StatusBadRequest, "agents join a reminder when mentioned")
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
	writeJSON(w, http.StatusOK, groupChatToResponse(issue, h.getIssuePrefix(r.Context(), issue.WorkspaceID), members, nil, userID))
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
	if issue.IsDirectChat {
		writeError(w, http.StatusBadRequest, "members of a direct chat cannot change")
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
