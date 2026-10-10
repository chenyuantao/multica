package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

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

// A reminder is a group chat created on the reminder page. The note the person
// writes is the description; a short title is filled in afterwards by the same
// kind of LLM call that names a chat session. Its messages are the details,
// and agents join when someone @mentions them in that note, in the title, or
// in a message. A mention in the note or the title assigns the agent and
// starts a run, so the person does not send a separate message. Until it has
// a message it stays off the IM chat list. Once it has one, it appears there
// as a task chat and sorts with the other conversations. It never appears in
// the issue lists.

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
	Description string `json:"description"`
	// DueDate is a calendar day (YYYY-MM-DD). "today" is the caller's day:
	// ?tz= when present, otherwise the timezone on their profile, otherwise UTC.
	DueDate  *string  `json:"due_date"`
	Position *float64 `json:"position"`
}

// reminderNow is the clock behind a due_date of "today". Tests pin it.
var reminderNow = time.Now

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
	description := strings.TrimSpace(sanitizeNullBytes(req.Description))
	if description == "" {
		writeError(w, http.StatusBadRequest, "description is required")
		return
	}
	dueDate, err := h.resolveReminderDueDate(r, req.DueDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid due_date")
		return
	}

	ctx := r.Context()
	creator := service.IssueMemberRef{Type: "member", ID: parseUUID(userID)}
	position := req.Position
	if position == nil && dueDate.Valid {
		end, err := h.reminderEndPosition(ctx, member.WorkspaceID, creator.ID, dueDate)
		if err != nil {
			slog.Warn("reminder position failed", append(logger.RequestAttrs(r), "error", err)...)
			writeError(w, http.StatusInternalServerError, "failed to create reminder")
			return
		}
		position = &end
	}
	prefix := h.getIssuePrefix(ctx, member.WorkspaceID)
	res, err := h.IssueService.Create(ctx, service.IssueCreateParams{
		WorkspaceID:    member.WorkspaceID,
		Title:          "",
		Description:    pgtype.Text{String: description, Valid: true},
		Status:         "todo",
		Priority:       "none",
		CreatorType:    "member",
		CreatorID:      creator.ID,
		DueDate:        dueDate,
		OriginType:     pgtype.Text{String: reminderOrigin, Valid: true},
		AllowDuplicate: true,
		Members:        []service.IssueMemberRef{creator},
		Position:       position,
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
	h.dispatchReminderTitleMentions(r, res.Issue, description, "")
	h.maybeGenerateReminderTitleAsync(uuidToString(member.WorkspaceID), userID, res.Issue.ID, description)

	members, err := h.Queries.ListIssueMembers(ctx, db.ListIssueMembersParams{IssueID: res.Issue.ID, WorkspaceID: res.Issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load reminder members")
		return
	}
	writeJSON(w, http.StatusCreated, reminderToResponse(res.Issue, prefix, members, userID))
}

func (h *Handler) resolveReminderDueDate(r *http.Request, raw *string) (pgtype.Date, error) {
	if raw == nil {
		return pgtype.Date{}, nil
	}
	value := strings.TrimSpace(*raw)
	if value == "" {
		return pgtype.Date{}, nil
	}
	if strings.EqualFold(value, "today") {
		loc, err := time.LoadLocation(h.resolveViewingTZ(r))
		if err != nil || loc == nil {
			loc = time.UTC
		}
		value = reminderNow().In(loc).Format("2006-01-02")
	}
	return util.ParseCalendarDate(value)
}

// reminderEndPosition is the slot after every reminder this person already has
// on the day, matching the page's end-of-day create.
func (h *Handler) reminderEndPosition(ctx context.Context, workspaceID, creatorID pgtype.UUID, due pgtype.Date) (float64, error) {
	max, err := h.Queries.MaxReminderPositionOnDay(ctx, db.MaxReminderPositionOnDayParams{
		WorkspaceID: workspaceID,
		CreatorID:   creatorID,
		DueDate:     due,
	})
	if err != nil {
		return 0, err
	}
	return max + 1, nil
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

type UpdateReminderRequest struct {
	Description *string  `json:"description"`
	Title       *string  `json:"title"`
	DueDate     *string  `json:"due_date"`
	Position    *float64 `json:"position"`
	// Status is "todo" or "done".
	Status  *string `json:"status"`
	Pending *bool   `json:"pending"`
}

// UpdateReminder edits one reminder belonging to the caller. A task token
// edits the reminders of the user bound to that token, and no one else's.
func (h *Handler) UpdateReminder(w http.ResponseWriter, r *http.Request) {
	r = h.withWakeupActor(r)
	issue, userID, ok := h.loadOwnedReminder(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var req UpdateReminderRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(raw) == 0 {
		writeError(w, http.StatusBadRequest, "no fields to update")
		return
	}

	prev := issue
	params := db.UpdateIssueParams{
		ID:            issue.ID,
		SourceTaskID:  h.wakeupSourceTaskID(r),
		AssigneeType:  issue.AssigneeType,
		AssigneeID:    issue.AssigneeID,
		StartDate:     issue.StartDate,
		DueDate:       issue.DueDate,
		ParentIssueID: issue.ParentIssueID,
		ProjectID:     issue.ProjectID,
		Stage:         issue.Stage,
	}
	fields := false
	if req.Title != nil {
		params.Title = pgtype.Text{String: strings.TrimSpace(sanitizeNullBytes(*req.Title)), Valid: true}
		fields = true
	}
	if req.Description != nil {
		description := strings.TrimSpace(sanitizeNullBytes(*req.Description))
		if description == "" {
			writeError(w, http.StatusBadRequest, "description is required")
			return
		}
		params.Description = pgtype.Text{String: description, Valid: true}
		fields = true
	}
	if _, present := raw["due_date"]; present {
		due, err := h.resolveReminderDueDate(r, req.DueDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid due_date")
			return
		}
		params.DueDate = due
		fields = true
	}
	if req.Position != nil {
		params.Position = pgtype.Float8{Float64: *req.Position, Valid: true}
		fields = true
	}
	if req.Status != nil {
		switch *req.Status {
		case "todo", "done":
		default:
			writeError(w, http.StatusBadRequest, "status must be 'todo' or 'done'")
			return
		}
		params.Status = pgtype.Text{String: *req.Status, Valid: true}
		fields = true
	}
	if req.Pending == nil && !fields {
		writeError(w, http.StatusBadRequest, "no fields to update")
		return
	}

	ctx := r.Context()
	if fields {
		if params.Status.Valid {
			issue, err = h.updateIssueWithStatusGuard(ctx, issue.WorkspaceID, params.Status.String, params)
		} else {
			issue, err = h.Queries.UpdateIssue(ctx, params)
		}
		if err != nil {
			slog.Warn("update reminder failed", append(logger.RequestAttrs(r), "error", err)...)
			writeError(w, http.StatusInternalServerError, "failed to update reminder")
			return
		}
	}
	if req.Pending != nil {
		if *req.Pending {
			value, _ := json.Marshal(true)
			_, err = h.Queries.SetIssueMetadataKey(ctx, db.SetIssueMetadataKeyParams{
				ID: issue.ID, WorkspaceID: issue.WorkspaceID, Key: reminderPendingKey, Value: value,
			})
		} else {
			_, err = h.Queries.DeleteIssueMetadataKey(ctx, db.DeleteIssueMetadataKeyParams{
				ID: issue.ID, WorkspaceID: issue.WorkspaceID, Key: reminderPendingKey,
			})
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("update reminder pending failed", append(logger.RequestAttrs(r), "error", err)...)
			writeError(w, http.StatusInternalServerError, "failed to update reminder")
			return
		}
		reloaded, reloadErr := h.Queries.GetIssueInWorkspace(ctx, db.GetIssueInWorkspaceParams{ID: issue.ID, WorkspaceID: issue.WorkspaceID})
		if reloadErr != nil {
			writeError(w, http.StatusInternalServerError, "failed to update reminder")
			return
		}
		issue = reloaded
	}

	if req.Description != nil && issue.Description.String != prev.Description.String {
		h.dispatchReminderTitleMentions(r, issue, issue.Description.String, prev.Description.String)
		if strings.TrimSpace(issue.Title) == "" && req.Title == nil {
			h.maybeGenerateReminderTitleAsync(uuidToString(issue.WorkspaceID), userID, issue.ID, issue.Description.String)
		}
	}
	if req.Title != nil && issue.Title != prev.Title {
		h.dispatchReminderTitleMentions(r, issue, issue.Title, prev.Title)
	}

	workspaceID := uuidToString(issue.WorkspaceID)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	prefix := h.getIssuePrefix(ctx, issue.WorkspaceID)
	resp := issueToResponse(issue, prefix)
	prevDue := dateToPtr(prev.DueDate)
	nextDue := dateToPtr(issue.DueDate)
	dueChanged := (prevDue == nil) != (nextDue == nil) || (prevDue != nil && nextDue != nil && *prevDue != *nextDue)
	h.publish(protocol.EventIssueUpdated, workspaceID, actorType, actorID, map[string]any{
		"issue":               resp,
		"status_changed":      prev.Status != issue.Status,
		"title_changed":       prev.Title != issue.Title,
		"description_changed": prev.Description.String != issue.Description.String,
		"due_date_changed":    dueChanged,
		"prev_status":         prev.Status,
		"prev_title":          prev.Title,
		"prev_description":    textToPtr(prev.Description),
		"prev_due_date":       prevDue,
		"creator_type":        prev.CreatorType,
		"creator_id":          uuidToString(prev.CreatorID),
	})
	h.publishGroupChatUpdated(workspaceID, userID, issue.ID)

	members, err := h.Queries.ListIssueMembers(ctx, db.ListIssueMembersParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load reminder members")
		return
	}
	writeJSON(w, http.StatusOK, reminderToResponse(issue, prefix, members, userID))
}

// DeleteReminder removes one reminder belonging to the caller.
func (h *Handler) DeleteReminder(w http.ResponseWriter, r *http.Request) {
	r = h.withWakeupActor(r)
	issue, userID, ok := h.loadOwnedReminder(w, r)
	if !ok {
		return
	}
	h.TaskService.CancelTasksForIssue(r.Context(), issue.ID)
	_ = h.AutopilotService.FailAutopilotRunsByIssue(r.Context(), issue.ID)
	deleteResult, err := h.deleteIssueAndCollectAttachmentURLs(r.Context(), issue, nil)
	if err != nil {
		slog.Warn("delete reminder failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to delete reminder")
		return
	}
	h.deleteS3Objects(r.Context(), deleteResult.AttachmentURLs)
	workspaceID := uuidToString(issue.WorkspaceID)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	resolvedID := uuidToString(issue.ID)
	h.publish(protocol.EventIssueDeleted, workspaceID, actorType, actorID, map[string]any{"issue_id": resolvedID})
	h.publishIssueSnapshots(r.Context(), deleteResult.DetachedChildren, actorType, actorID)
	h.publishClearedDuplicates(r.Context(), deleteResult.ClearedDuplicates, actorType, actorID)
	h.publishGroupChatUpdated(workspaceID, userID, issue.ID)
	w.WriteHeader(http.StatusNoContent)
}

// loadOwnedReminder returns a reminder whose creator is the caller. Anyone
// else, including another member, gets the same not-found response.
func (h *Handler) loadOwnedReminder(w http.ResponseWriter, r *http.Request) (db.Issue, string, bool) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return db.Issue{}, "", false
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return db.Issue{}, "", false
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "id")
	if !ok {
		return db.Issue{}, "", false
	}
	issue, err := h.Queries.GetIssueInWorkspace(r.Context(), db.GetIssueInWorkspaceParams{ID: id, WorkspaceID: wsUUID})
	if err != nil || !isReminder(issue) || issue.CreatorType != "member" || uuidToString(issue.CreatorID) != userID {
		writeError(w, http.StatusNotFound, "reminder not found")
		return db.Issue{}, "", false
	}
	return issue, userID, true
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
	// A task token acts for the user the task belongs to. Mentions in that
	// person's reminder are admitted as them, not as the agent.
	if actorType != "member" {
		if r.Header.Get("X-Actor-Source") != "task_token" {
			return
		}
		actorType = "member"
		actorID = requestUserID(r)
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

// dispatchReminderTitleMentions assigns every agent newly named in content.
// On create, content is the note the person wrote. On a later title edit, it
// is the title. The agent joins and a run starts, and no message is posted.
// Agents already named in previous are left alone, so editing the wording
// does not start another run.
func (h *Handler) dispatchReminderTitleMentions(r *http.Request, issue db.Issue, content, previous string) {
	if !isReminder(issue) {
		return
	}
	h.admitReminderMentionedAgents(r, issue, content)
	already := map[string]struct{}{}
	for _, m := range util.ParseMentions(previous) {
		if m.Type == "agent" {
			already[strings.ToLower(m.ID)] = struct{}{}
		}
	}
	ctx := r.Context()
	for _, m := range util.ParseMentions(content) {
		if m.Type != "agent" {
			continue
		}
		if _, seen := already[strings.ToLower(m.ID)]; seen {
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

// reminderTitleSystemPrompt matches the chat-session title rules: a few words,
// the note's own language, and nothing but the title. It names no language and
// contains no CJK, for the same reason as chatTitleSystemPrompt.
const reminderTitleSystemPrompt = `You write a very short title that summarizes a to-do note.

Rules:
- Output ONLY the title text — nothing else, no explanation.
- Keep it short: a few words, ideally under 8, never a full sentence.
- Write the title in the SAME language as the note, and in no other.
- Do NOT wrap the title in quotes or brackets.
- Do NOT prefix it with a label such as "Title:", in any language.
- Do NOT end with a period or any trailing punctuation.
- Do NOT include @mentions or #tags.`

var reminderMentionLink = regexp.MustCompile(`\[@([^\]]+)\]\(mention://(?:agent|member)/[^)]+\)`)

// reminderTitleSource is the note the model summarizes, with mention links
// reduced to @Name so the title is not asked to copy a URL.
func reminderTitleSource(description string) string {
	return strings.TrimSpace(reminderMentionLink.ReplaceAllString(description, "@$1"))
}

// maybeGenerateReminderTitleAsync fills in a short title from the note and
// returns immediately. A missing LLM, a failed call, or a title someone
// already typed leaves the reminder untitled, and the list keeps showing the note.
func (h *Handler) maybeGenerateReminderTitleAsync(workspaceID, userID string, issueID pgtype.UUID, description string) {
	if h.LLM == nil || !h.LLM.Enabled() {
		return
	}
	source := reminderTitleSource(description)
	if source == "" {
		return
	}
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("reminder title generation panicked; leaving the title empty",
					"issue_id", uuidToString(issueID),
					"panic", rec,
				)
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), chatTitleGenTimeout)
		defer cancel()
		_, applied, err := h.generateReminderTitle(ctx, issueID, parseUUID(workspaceID), source)
		if err != nil {
			slog.Warn("reminder title generation failed; leaving the title empty",
				"issue_id", uuidToString(issueID),
				"error", err,
			)
			return
		}
		if !applied {
			return
		}
		h.publishGroupChatUpdated(workspaceID, userID, issueID)
	}()
}

// generateReminderTitle asks the LLM for a title and writes it only while the
// reminder's title is still empty.
//
//	(title, true, nil):  a title was written.
//	("", false, nil):    nothing usable, or the title was no longer empty.
//	("", false, err):    the LLM call or the write failed.
func (h *Handler) generateReminderTitle(ctx context.Context, issueID, workspaceID pgtype.UUID, source string) (string, bool, error) {
	raw, err := h.LLM.GenerateText(ctx, "", reminderTitleSystemPrompt, source)
	if err != nil {
		return "", false, err
	}
	title := sanitizeChatTitle(raw)
	if title == "" {
		return "", false, nil
	}
	updated, err := h.Queries.UpdateIssueTitleIfEmpty(ctx, db.UpdateIssueTitleIfEmptyParams{
		ID:          issueID,
		WorkspaceID: workspaceID,
		NewTitle:    title,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return updated.Title, true, nil
}
