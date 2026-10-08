package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// A reminder is a group chat created on the reminder page: its title is the
// to-do, its messages are the details, and agents join when someone @mentions
// them in the title or in a message. A title mention assigns the agent and
// starts a run, so the person does not send a separate message. It never
// appears in the IM chat list or the issue lists.

const (
	reminderOrigin    = "reminder"
	reminderListLimit = 1000
	// reminderPendingKey is the issue metadata key that pins an unfinished
	// reminder above the days, whatever its due date.
	reminderPendingKey = "reminder_pending"
)

// notReminderIssue keeps reminders out of the workspace issue lists.
const notReminderIssue = "i.origin_type IS DISTINCT FROM 'reminder'"

func isReminder(issue db.Issue) bool {
	return issue.OriginType.Valid && issue.OriginType.String == reminderOrigin
}

type ReminderResponse struct {
	GroupChatResponse
	Status    string  `json:"status"`
	DueDate   *string `json:"due_date"`
	Position  float64 `json:"position"`
	UpdatedAt string  `json:"updated_at"`
	Pending   bool    `json:"pending"`
}

func reminderToResponse(issue db.Issue, prefix string, members []db.IssueMember, userID string) ReminderResponse {
	pending, _ := parseIssueMetadata(issue.Metadata)[reminderPendingKey].(bool)
	return ReminderResponse{
		GroupChatResponse: groupChatToResponse(issue, prefix, members, nil, userID),
		Status:            issue.Status,
		DueDate:           dateToPtr(issue.DueDate),
		Position:          issue.Position,
		UpdatedAt:         timestampToString(issue.UpdatedAt),
		Pending:           pending,
	}
}

type CreateReminderRequest struct {
	Title    string   `json:"title"`
	DueDate  *string  `json:"due_date"`
	Position *float64 `json:"position"`
}

func (h *Handler) CreateReminder(w http.ResponseWriter, r *http.Request) {
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
	var req CreateReminderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	title := strings.TrimSpace(sanitizeNullBytes(req.Title))
	if title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	var dueDate pgtype.Date
	if req.DueDate != nil && *req.DueDate != "" {
		d, err := util.ParseCalendarDate(*req.DueDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid due_date")
			return
		}
		dueDate = d
	}

	ctx := r.Context()
	creator := service.IssueMemberRef{Type: "member", ID: parseUUID(userID)}
	prefix := h.getIssuePrefix(ctx, member.WorkspaceID)
	res, err := h.IssueService.Create(ctx, service.IssueCreateParams{
		WorkspaceID:    member.WorkspaceID,
		Title:          title,
		Status:         "todo",
		Priority:       "none",
		CreatorType:    "member",
		CreatorID:      creator.ID,
		DueDate:        dueDate,
		OriginType:     pgtype.Text{String: reminderOrigin, Valid: true},
		AllowDuplicate: true,
		Members:        []service.IssueMemberRef{creator},
		Position:       req.Position,
	}, service.IssueCreateOpts{
		ActorID:  userID,
		Platform: func() string { p, _, _ := middleware.ClientMetadataFromContext(ctx); return p }(),
		BroadcastPayload: func(issue db.Issue, _ []db.Attachment, _ []db.IssueLabel) map[string]any {
			return map[string]any{"issue": issueToResponse(issue, prefix)}
		},
	})
	if writeIssueLimitReached(w, err) {
		return
	}
	if err != nil {
		slog.Warn("create reminder failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create reminder")
		return
	}
	h.subscribeGroupChatMember(ctx, res.Issue.ID, creator)
	h.dispatchReminderTitleMentions(r, res.Issue, "")

	members, err := h.Queries.ListIssueMembers(ctx, db.ListIssueMembersParams{IssueID: res.Issue.ID, WorkspaceID: res.Issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load reminder members")
		return
	}
	writeJSON(w, http.StatusCreated, reminderToResponse(res.Issue, prefix, members, userID))
}

// ListReminders returns the requester's reminders. from/to (YYYY-MM-DD,
// inclusive) narrow them to a due-date window; status=open|done narrows them
// to unfinished or finished ones.
func (h *Handler) ListReminders(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return
	}
	query := r.URL.Query()
	params := db.ListRemindersForCreatorParams{
		WorkspaceID: wsUUID,
		CreatorID:   parseUUID(userID),
		RowLimit:    reminderListLimit,
	}
	for _, bound := range []struct {
		name string
		dst  *pgtype.Date
	}{{"from", &params.DueFrom}, {"to", &params.DueTo}} {
		raw := strings.TrimSpace(query.Get(bound.name))
		if raw == "" {
			continue
		}
		d, err := util.ParseCalendarDate(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid "+bound.name)
			return
		}
		*bound.dst = d
	}
	switch query.Get("status") {
	case "":
	case "open":
		params.Done = pgtype.Bool{Bool: false, Valid: true}
	case "done":
		params.Done = pgtype.Bool{Bool: true, Valid: true}
	default:
		writeError(w, http.StatusBadRequest, "status must be 'open' or 'done'")
		return
	}

	ctx := r.Context()
	issues, err := h.Queries.ListRemindersForCreator(ctx, params)
	if err != nil {
		slog.Warn("list reminders failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to list reminders")
		return
	}
	ids := make([]pgtype.UUID, 0, len(issues))
	for _, issue := range issues {
		ids = append(ids, issue.ID)
	}
	membersByIssue := map[string][]db.IssueMember{}
	if len(ids) > 0 {
		members, err := h.Queries.ListIssueMembersForIssues(ctx, db.ListIssueMembersForIssuesParams{WorkspaceID: wsUUID, IssueIds: ids})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load reminder members")
			return
		}
		for _, m := range members {
			key := uuidToString(m.IssueID)
			membersByIssue[key] = append(membersByIssue[key], m)
		}
	}
	prefix := h.getIssuePrefix(ctx, wsUUID)
	pending := h.pendingSpeakersByIssue(ctx, ids)
	unread := h.groupChatUnreadCounts(ctx, wsUUID, parseUUID(userID), ids)
	out := make([]ReminderResponse, 0, len(issues))
	for _, issue := range issues {
		key := uuidToString(issue.ID)
		resp := reminderToResponse(issue, prefix, membersByIssue[key], userID)
		if speakers := pending[key]; len(speakers) > 0 {
			resp.PendingSpeakers = speakers
		}
		resp.UnreadCount = unread[key]
		out = append(out, resp)
	}
	writeJSON(w, http.StatusOK, map[string]any{"reminders": out})
}

// admitReminderMentionedAgents adds each agent a person @mentions in a
// reminder message to the reminder, whether or not it worked there before, so
// the ordinary group chat dispatch reaches it. An agent the person may not
// bring into a chat is left out, and rejectNonMemberAgentMentions refuses the
// message as it would in any chat.
func (h *Handler) admitReminderMentionedAgents(r *http.Request, issue db.Issue, content string) {
	if !isReminder(issue) {
		return
	}
	ctx := r.Context()
	workspaceID := uuidToString(issue.WorkspaceID)
	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	if actorType != "member" {
		return
	}
	member, ok := ctxMember(ctx)
	if !ok {
		return
	}
	added := false
	for _, m := range util.ParseMentions(content) {
		if m.Type != "agent" {
			continue
		}
		id, err := util.ParseUUID(m.ID)
		if err != nil {
			continue
		}
		agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: id, WorkspaceID: issue.WorkspaceID})
		if err != nil || agent.ArchivedAt.Valid || !h.memberCanWireAgent(ctx, member, agent, workspaceID) {
			continue
		}
		if err := h.Queries.AddIssueMember(ctx, db.AddIssueMemberParams{
			IssueID:     issue.ID,
			WorkspaceID: issue.WorkspaceID,
			MemberType:  "agent",
			MemberID:    agent.ID,
			AddedByType: pgtype.Text{String: "member", Valid: true},
			AddedByID:   parseUUID(actorID),
		}); err != nil {
			slog.Warn("add mentioned agent to reminder failed", "issue_id", uuidToString(issue.ID), "agent_id", m.ID, "error", err)
			continue
		}
		added = true
	}
	if added {
		h.publishGroupChatUpdated(workspaceID, actorID, issue.ID)
	}
}

// dispatchReminderTitleMentions assigns every agent newly named in a reminder
// title. The title is the assignment: the agent joins and a run starts, and no
// message is posted. Agents already named in previousTitle are left alone, so
// editing the wording does not start another run.
func (h *Handler) dispatchReminderTitleMentions(r *http.Request, issue db.Issue, previousTitle string) {
	if !isReminder(issue) {
		return
	}
	h.admitReminderMentionedAgents(r, issue, issue.Title)
	previous := map[string]struct{}{}
	for _, m := range util.ParseMentions(previousTitle) {
		if m.Type == "agent" {
			previous[strings.ToLower(m.ID)] = struct{}{}
		}
	}
	ctx := r.Context()
	for _, m := range util.ParseMentions(issue.Title) {
		if m.Type != "agent" {
			continue
		}
		if _, seen := previous[strings.ToLower(m.ID)]; seen {
			continue
		}
		id, err := util.ParseUUID(m.ID)
		if err != nil {
			continue
		}
		agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: id, WorkspaceID: issue.WorkspaceID})
		if err != nil || agent.ArchivedAt.Valid {
			continue
		}
		isMember, err := h.Queries.IsIssueMember(ctx, db.IsIssueMemberParams{IssueID: issue.ID, MemberType: "agent", MemberID: id})
		if err != nil || !isMember {
			continue
		}
		if _, err := h.TaskService.EnqueueTaskForMention(ctx, issue, id, pgtype.UUID{}, service.OriginNamed); err != nil && !errors.Is(err, service.ErrDuplicatePendingTask) {
			slog.Warn("enqueue reminder title mention failed", "issue_id", uuidToString(issue.ID), "agent_id", m.ID, "error", err)
		}
	}
}
