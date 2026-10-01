package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	groupChatHistoryLimit     = 200
	groupChatJudgmentMessages = 30
	groupChatPromptRunes      = 24000
	groupChatMessageRunes     = 6000
)

type groupChatPerson struct {
	groupchat.Participant
	Description string
}

// rejectAmbiguousGroupChatMention refuses a group message whose bare @Name
// matches more than one member. The comment is not saved. A chat with one
// agent routes nothing, so nothing is rejected there.
func (h *Handler) rejectAmbiguousGroupChatMention(w http.ResponseWriter, r *http.Request, issue db.Issue, content string) bool {
	roster, ok := h.groupChatRosterIfChat(r.Context(), issue)
	if !ok {
		return false
	}
	people := participantsOf(roster)
	if len(groupchat.AgentsOf(people)) == 1 {
		return false
	}
	address := groupchat.Route(content, people)
	if address.Kind != groupchat.KindAmbiguous {
		return false
	}
	writeError(w, http.StatusBadRequest, "more than one member is named "+address.Name)
	return true
}

// dispatchGroupChatReply replaces issue-comment routing for a person posting
// in a group chat. A chat with one agent always goes to that agent. A message
// that opens with one @ of an agent is enqueued directly. Several named agents
// are planned only for parallel versus ordered delivery. A message that names
// nobody is planned against the full history. When Jev gives no usable
// answer, named agents speak in the order they were named and anything else
// goes to the group's first agent. A message that is only attachments starts
// nobody; it is read as context with the next message.
func (h *Handler) dispatchGroupChatReply(ctx context.Context, issue db.Issue, comment db.Comment) []CommentTriggerOutcome {
	if h.isAttachmentOnlyComment(ctx, issue, comment) {
		return nil
	}
	roster, ok := h.groupChatRosterIfChat(ctx, issue)
	if !ok {
		return nil
	}
	people := participantsOf(roster)
	agents := groupchat.AgentsOf(people)
	switch len(agents) {
	case 0:
		return nil
	case 1:
		h.enqueueGroupChatPlan(ctx, issue, comment.ID, groupchat.Plan{Mode: groupchat.ModeSingle, AgentIDs: []string{agents[0].ID}})
		return nil
	}
	address := groupchat.Route(comment.Content, people)
	if address.Kind == groupchat.KindAmbiguous || address.Kind == groupchat.KindNone {
		return nil
	}
	state := h.groupChatJudgmentState(ctx, issue, roster)
	plan, err := groupchat.Decide(ctx, h.GroupChatDecider, state, people, address)
	if err != nil {
		slog.Info("group chat plan fell back", "issue_id", uuidToString(issue.ID), "kind", address.Kind, "error", err)
		plan = groupchat.FallbackPlan(people, address)
	}
	h.enqueueGroupChatPlan(ctx, issue, comment.ID, plan)
	return nil
}

func (h *Handler) isAttachmentOnlyComment(ctx context.Context, issue db.Issue, comment db.Comment) bool {
	attachments, err := h.Queries.ListAttachmentsByComment(ctx, db.ListAttachmentsByCommentParams{CommentID: comment.ID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		slog.Warn("group chat attachments failed", "comment_id", uuidToString(comment.ID), "error", err)
		return false
	}
	urls := make([]string, 0, len(attachments)*3)
	for _, a := range attachments {
		id := uuidToString(a.ID)
		urls = append(urls, a.Url, util.AttachmentDownloadPath(id), h.buildMarkdownURL(a, id))
	}
	return groupchat.AttachmentOnly(comment.Content, urls)
}

func (h *Handler) enqueueGroupChatPlan(ctx context.Context, issue db.Issue, commentID pgtype.UUID, plan groupchat.Plan) {
	dispatch, now := plan.Now()
	var first pgtype.UUID
	for i, rawID := range now {
		agentID, err := util.ParseUUID(rawID)
		if err != nil {
			continue
		}
		task, err := h.TaskService.EnqueueTaskForMention(ctx, issue, agentID, commentID, service.OriginNamed)
		if err != nil {
			if !errors.Is(err, service.ErrDuplicatePendingTask) {
				slog.Warn("group chat enqueue failed", "issue_id", uuidToString(issue.ID), "agent_id", rawID, "error", err)
			}
			continue
		}
		h.TaskService.OpenGroupChatThinking(ctx, issue, task)
		if i == 0 {
			first = task.ID
		}
	}
	if dispatch.Mode != groupchat.ModeSequential || !first.Valid {
		return
	}
	raw, err := json.Marshal(dispatch)
	if err != nil {
		return
	}
	if err := h.Queries.SetGroupChatDispatch(ctx, db.SetGroupChatDispatchParams{ID: first, Plan: raw}); err != nil {
		slog.Warn("group chat dispatch plan was not stored", "task_id", uuidToString(first), "error", err)
	}
}

// isGroupChat reports whether the issue is a group chat.
func (h *Handler) isGroupChat(ctx context.Context, issue db.Issue) bool {
	has, err := h.Queries.IssueHasMembers(ctx, issue.ID)
	return err == nil && has
}

func (h *Handler) groupChatRosterIfChat(ctx context.Context, issue db.Issue) ([]groupChatPerson, bool) {
	if !h.isGroupChat(ctx, issue) {
		return nil, false
	}
	members, err := h.Queries.ListIssueMembers(ctx, db.ListIssueMembersParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		slog.Warn("group chat roster failed", "issue_id", uuidToString(issue.ID), "error", err)
		return nil, false
	}
	if len(members) == 0 {
		return nil, false
	}
	var userIDs []pgtype.UUID
	for _, m := range members {
		if m.MemberType == "member" {
			userIDs = append(userIDs, m.MemberID)
		}
	}
	names := map[string]string{}
	if len(userIDs) > 0 {
		users, err := h.Queries.GetUsersByIDs(ctx, userIDs)
		if err != nil {
			slog.Warn("group chat member names failed", "issue_id", uuidToString(issue.ID), "error", err)
		} else {
			for _, u := range users {
				names[uuidToString(u.ID)] = u.Name
			}
		}
	}
	roster := make([]groupChatPerson, 0, len(members))
	for _, m := range members {
		id := uuidToString(m.MemberID)
		person := groupChatPerson{Participant: groupchat.Participant{Type: m.MemberType, ID: id, Name: names[id]}}
		if m.MemberType == "agent" {
			agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: m.MemberID, WorkspaceID: issue.WorkspaceID})
			if err != nil {
				person.Name = id
			} else {
				person.Name = agent.Name
				person.Description = trimRunes(agent.Description, 240)
			}
		}
		if person.Name == "" {
			person.Name = id
		}
		roster = append(roster, person)
	}
	return roster, true
}

func (h *Handler) groupChatJudgmentState(ctx context.Context, issue db.Issue, roster []groupChatPerson) groupchat.State {
	turns := h.groupChatTurns(ctx, issue, roster)
	if len(turns) > groupChatJudgmentMessages {
		turns = turns[len(turns)-groupChatJudgmentMessages:]
	}
	messages := make([]groupchat.Message, 0, len(turns))
	for _, turn := range turns {
		messages = append(messages, groupchat.Message{
			Time: turn.Time, Sender: turn.Author, Content: turn.Text,
		})
	}
	var cards []groupchat.Card
	for _, p := range roster {
		if p.Type != "agent" {
			continue
		}
		cards = append(cards, groupchat.Card{ID: p.ID, Name: p.Name, Description: p.Description})
	}
	return groupchat.State{Agents: cards, Messages: messages}
}

func (h *Handler) groupChatTurns(ctx context.Context, issue db.Issue, roster []groupChatPerson) []groupchat.Turn {
	comments, err := h.Queries.ListCommentsForIssue(ctx, db.ListCommentsForIssueParams{
		IssueID: issue.ID, WorkspaceID: issue.WorkspaceID, Limit: groupChatHistoryLimit,
	})
	if err != nil {
		slog.Warn("group chat history failed", "issue_id", uuidToString(issue.ID), "error", err)
		return nil
	}
	byID := map[string]groupChatPerson{}
	for _, p := range roster {
		byID[p.Type+":"+p.ID] = p
	}
	toTurn := func(c db.Comment) groupchat.Turn {
		name := c.AuthorType
		if p, ok := byID[c.AuthorType+":"+uuidToString(c.AuthorID)]; ok {
			name = p.Name
		}
		when := ""
		if c.CreatedAt.Valid {
			when = c.CreatedAt.Time.UTC().Format(time.RFC3339)
		}
		return groupchat.Turn{ID: uuidToString(c.ID), Author: name, AuthorID: uuidToString(c.AuthorID), Role: c.AuthorType, Text: c.Content, Time: when}
	}
	byCommentID := make(map[string]db.Comment, len(comments))
	for _, c := range comments {
		byCommentID[uuidToString(c.ID)] = c
	}
	turns := make([]groupchat.Turn, 0, len(comments))
	for _, c := range comments {
		if c.DeletedAt.Valid || c.Type == "system" || c.Type == "status_change" {
			continue
		}
		// The thinking bubble is a stand-in, not something the next speaker
		// or the planner should treat as a message.
		if c.AuthorType == "agent" && c.Content == groupchat.ThinkingMessage {
			continue
		}
		turn := toTurn(c)
		if ref, ok := h.groupChatRefMessage(ctx, issue, c.RefMessageID, byCommentID); ok {
			quoted := toTurn(ref)
			turn.Ref = &quoted
		}
		turns = append(turns, turn)
	}
	h.markGroupChatAttachments(ctx, issue, turns)
	return turns
}

// markGroupChatAttachments flags messages that carry a file. The filter
// keeps those messages, because Jev cannot judge the file.
func (h *Handler) markGroupChatAttachments(ctx context.Context, issue db.Issue, turns []groupchat.Turn) {
	ids := make([]pgtype.UUID, 0, len(turns))
	seen := map[string]bool{}
	add := func(id string) {
		if id == "" || seen[id] {
			return
		}
		parsed, err := util.ParseUUID(id)
		if err != nil {
			return
		}
		seen[id] = true
		ids = append(ids, parsed)
	}
	for _, turn := range turns {
		add(turn.ID)
		if turn.Ref != nil {
			add(turn.Ref.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	rows, err := h.Queries.ListAttachmentsByCommentIDs(ctx, db.ListAttachmentsByCommentIDsParams{
		Column1: ids, WorkspaceID: issue.WorkspaceID,
	})
	if err != nil {
		slog.Warn("group chat attachments failed", "issue_id", uuidToString(issue.ID), "error", err)
		// Without this list every message might be a file, so keep them all.
		for i := range turns {
			turns[i].Attachment = true
			if turns[i].Ref != nil {
				turns[i].Ref.Attachment = true
			}
		}
		return
	}
	has := map[string]bool{}
	for _, row := range rows {
		if row.CommentID.Valid {
			has[uuidToString(row.CommentID)] = true
		}
	}
	for i := range turns {
		turns[i].Attachment = has[turns[i].ID]
		if turns[i].Ref != nil {
			turns[i].Ref.Attachment = has[turns[i].Ref.ID]
		}
	}
}

// groupChatRefMessage loads the live message a group message quotes, from the
// loaded history when it is there and from the database when it is older.
func (h *Handler) groupChatRefMessage(ctx context.Context, issue db.Issue, refID pgtype.UUID, loaded map[string]db.Comment) (db.Comment, bool) {
	if !refID.Valid {
		return db.Comment{}, false
	}
	ref, ok := loaded[uuidToString(refID)]
	if !ok {
		var err error
		ref, err = h.Queries.GetCommentInWorkspace(ctx, db.GetCommentInWorkspaceParams{ID: refID, WorkspaceID: issue.WorkspaceID})
		if err != nil {
			return db.Comment{}, false
		}
	}
	if ref.DeletedAt.Valid || uuidToString(ref.IssueID) != uuidToString(issue.ID) {
		return db.Comment{}, false
	}
	return ref, true
}

// attachGroupChatTranscript fills the claim payload with the ordered group
// history so the agent does not reconstruct the chat as separate threads.
func (h *Handler) attachGroupChatTranscript(ctx context.Context, resp *AgentTaskResponse, issue db.Issue, task db.AgentTaskQueue) {
	roster, ok := h.groupChatRosterIfChat(ctx, issue)
	if !ok {
		return
	}
	triggerIDs := uuidsToStrings(task.CoalescedCommentIds)
	if task.TriggerCommentID.Valid {
		triggerIDs = append(triggerIDs, uuidToString(task.TriggerCommentID))
	}
	turns := h.groupChatTurns(ctx, issue, roster)
	transcript := groupchat.SelectTranscript(turns, triggerIDs, groupChatPromptRunes, groupChatMessageRunes)
	if len(transcript.Excerpts) == 0 {
		return
	}
	// A direct chat is a two-person conversation. Its name and announcement
	// are not part of the transcript; each message already names its sender.
	if !issue.IsDirectChat {
		transcript.Title = issue.Title
		transcript.Notice = issue.Description.String
	}
	h.hideIrrelevantGroupChatMessages(ctx, &transcript, turns, triggerIDs, roster, issue, task)
	resp.GroupChatTranscript = transcript.Render(uuidToString(issue.ID), groupChatRoleLine(task))
}

// hideIrrelevantGroupChatMessages asks Jev, in a second request after the
// agent is already known, which delivered messages that agent does not need.
// A failure leaves the transcript unchanged. The latest check message and the
// contiguous messages that person sent just before it are never hidden.
func (h *Handler) hideIrrelevantGroupChatMessages(ctx context.Context, transcript *groupchat.Transcript, turns []groupchat.Turn, triggerIDs []string, roster []groupChatPerson, issue db.Issue, task db.AgentTaskQueue) {
	if h.GroupChatDecider == nil || !h.GroupChatDecider.Enabled() || !task.AgentID.Valid {
		return
	}
	agentID := uuidToString(task.AgentID)
	var card groupchat.Card
	found := false
	for _, p := range roster {
		if p.Type == "agent" && p.ID == agentID {
			card = groupchat.Card{ID: p.ID, Name: p.Name, Description: p.Description}
			found = true
			break
		}
	}
	if !found {
		return
	}
	protected := groupchat.RequiredVisible(turns, triggerIDs)
	hidden, err := groupchat.FilterForAgent(ctx, h.GroupChatDecider, card, transcript.Excerpts, protected)
	if err != nil {
		slog.Warn("group chat message filter failed", "issue_id", uuidToString(issue.ID), "agent_id", agentID, "error", err)
		return
	}
	groupchat.HideMessages(transcript, hidden)
}

func groupChatRoleLine(task db.AgentTaskQueue) string {
	if d, ok := groupchat.ParseDispatch(task.Context); ok && d.Mode == groupchat.ModeSequential && len(d.AgentIDs) > 1 {
		return fmt.Sprintf("You are speaker %d of %d in an ordered group reply. Say your part only. This is one group conversation, not a set of threads. Answer the messages marked trigger=\"true\".", d.Cursor+1, len(d.AgentIDs))
	}
	return "This is one group conversation, not a set of threads. Answer the messages marked trigger=\"true\", using the rest as context."
}

func (h *Handler) pendingSpeakersByIssue(ctx context.Context, ids []pgtype.UUID) map[string][]string {
	if len(ids) == 0 {
		return nil
	}
	tasks, err := h.Queries.ListActiveTasksForIssues(ctx, ids)
	if err != nil {
		slog.Warn("group chat pending speakers failed", "error", err)
		return nil
	}
	grouped := map[string][]groupchat.ActiveTask{}
	for _, task := range tasks {
		key := uuidToString(task.IssueID)
		grouped[key] = append(grouped[key], groupchat.ActiveTask{
			AgentID: uuidToString(task.AgentID),
			Context: task.Context,
		})
	}
	out := make(map[string][]string, len(grouped))
	for key, active := range grouped {
		out[key] = groupchat.PendingAgentIDs(active)
	}
	return out
}

func participantsOf(roster []groupChatPerson) []groupchat.Participant {
	out := make([]groupchat.Participant, len(roster))
	for i, p := range roster {
		out[i] = p.Participant
	}
	return out
}

// absorbGroupChatThinking writes the agent's finished reply into the bubble
// that already says it is thinking. A second comment is not created.
func (h *Handler) absorbGroupChatThinking(w http.ResponseWriter, r *http.Request, issue db.Issue, task *db.AgentTaskQueue, content string, attachmentIDs, suppressAgentIDs, steerTaskIDs []pgtype.UUID, authorType, authorID string) bool {
	if task == nil || !task.IssueID.Valid || uuidToString(task.IssueID) != uuidToString(issue.ID) {
		return false
	}
	placeholder, ok := groupchat.OpenPlaceholder(task.Context)
	if !ok {
		return false
	}
	commentID, err := util.ParseUUID(placeholder.CommentID)
	if err != nil {
		return false
	}
	existing, err := h.Queries.GetComment(r.Context(), commentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			h.TaskService.CloseGroupChatPlaceholder(r.Context(), task.ID, placeholder.CommentID)
			return false
		}
		slog.Warn("group chat thinking comment could not be loaded", append(logger.RequestAttrs(r), "error", err, "comment_id", placeholder.CommentID)...)
		writeError(w, http.StatusInternalServerError, "failed to update comment")
		return true
	}
	if existing.DeletedAt.Valid || uuidToString(existing.IssueID) != uuidToString(issue.ID) || uuidToString(existing.AuthorID) != uuidToString(task.AgentID) {
		h.TaskService.CloseGroupChatPlaceholder(r.Context(), task.ID, placeholder.CommentID)
		return false
	}
	updated, err := wakeupWrite(h, r, func(q *db.Queries) (db.UpdateCommentRow, error) {
		return q.UpdateComment(r.Context(), db.UpdateCommentParams{
			ID:                 existing.ID,
			Content:            content,
			SourceTaskID:       task.ID,
			SuppressedAgentIds: suppressAgentIDs,
		})
	})
	if err != nil {
		slog.Warn("group chat reply did not replace the thinking comment", append(logger.RequestAttrs(r), "error", err, "comment_id", placeholder.CommentID)...)
		writeError(w, http.StatusInternalServerError, "failed to update comment")
		return true
	}
	h.TaskService.CloseGroupChatPlaceholder(r.Context(), task.ID, placeholder.CommentID)
	comment := updated.Comment()
	if len(attachmentIDs) > 0 {
		h.linkGroupChatReplyAttachments(r, issue, comment.ID, attachmentIDs)
	}
	groupedAtt := h.groupAttachments(r, []pgtype.UUID{comment.ID})
	resp := commentToResponse(comment, nil, groupedAtt[uuidToString(comment.ID)])
	resp.IssueRevision = updated.IssueRevision
	h.publish(protocol.EventCommentUpdated, uuidToString(issue.WorkspaceID), authorType, authorID, map[string]any{
		"comment":              resp,
		"issue_revision":       updated.IssueRevision,
		"issue_title":          issue.Title,
		"issue_status":         issue.Status,
		groupchat.PayloadReply: true,
	})
	var parentComment *db.Comment
	if comment.ParentID.Valid {
		if parent, err := h.Queries.GetComment(r.Context(), comment.ParentID); err == nil {
			parentComment = &parent
		}
	}
	originatorUserID := h.invokeOriginatorFromRequest(r, authorType, authorID)
	resp.TriggerOutcomes = h.triggerTasksForComment(r.Context(), issue, comment, parentComment, authorType, authorID, originatorUserID, suppressAgentIDs, steerTaskIDs)
	writeJSON(w, http.StatusCreated, resp)
	return true
}

func (h *Handler) linkGroupChatReplyAttachments(r *http.Request, issue db.Issue, commentID pgtype.UUID, attachmentIDs []pgtype.UUID) {
	tx, err := h.beginWakeupWrite(r.Context())
	if err != nil {
		slog.Warn("group chat reply attachments were not linked", "error", err)
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)
	missing, err := lockCommentAttachments(r.Context(), qtx, issue.WorkspaceID, issue.ID, attachmentIDs)
	if err != nil || missing.Valid {
		slog.Warn("group chat reply attachments were not linked", "error", err, "missing", missing.Valid)
		return
	}
	if err := qtx.LinkAttachmentsToComment(r.Context(), db.LinkAttachmentsToCommentParams{
		CommentID: commentID,
		IssueID:   issue.ID,
		Column3:   attachmentIDs,
	}); err != nil {
		slog.Warn("group chat reply attachments were not linked", "error", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		slog.Warn("group chat reply attachments were not linked", "error", err)
	}
}

func trimRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	runes := []rune(s)
	return string(runes[:n])
}
