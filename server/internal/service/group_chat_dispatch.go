package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/dbid"
	"github.com/multica-ai/multica/server/pkg/protocol"
	"github.com/multica-ai/multica/server/pkg/redact"
)

// continueGroupChatDispatch starts the next agent in an ordered group reply
// after the agent at the plan cursor finishes. Independent replies are all
// enqueued up front and do not pass through here.
func (s *TaskService) continueGroupChatDispatch(ctx context.Context, task db.AgentTaskQueue) {
	current, ok := groupchat.ParseDispatch(task.Context)
	if !ok || !task.IssueID.Valid {
		return
	}
	next, agentID, ok := current.Next()
	if !ok {
		return
	}
	issue, err := s.Queries.GetIssue(ctx, task.IssueID)
	if err != nil {
		slog.Warn("group chat continuation could not load the issue", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	id, err := util.ParseUUID(agentID)
	if err != nil {
		return
	}
	created, err := s.EnqueueTaskForMention(ctx, issue, id, task.TriggerCommentID, OriginNamed)
	if err != nil {
		slog.Warn("group chat continuation was not enqueued", "task_id", util.UUIDToString(task.ID), "agent_id", agentID, "error", err)
		return
	}
	s.OpenGroupChatThinking(ctx, issue, created)
	raw, err := json.Marshal(next)
	if err != nil {
		return
	}
	if err := s.Queries.SetGroupChatDispatch(ctx, db.SetGroupChatDispatchParams{ID: created.ID, Plan: raw}); err != nil {
		slog.Warn("group chat continuation plan was not stored", "task_id", util.UUIDToString(created.ID), "error", err)
	}
}

// OpenGroupChatThinking posts the agent's "thinking" bubble as soon as that
// agent is chosen, before the run produces any text.
func (s *TaskService) OpenGroupChatThinking(ctx context.Context, issue db.Issue, task db.AgentTaskQueue) {
	if !task.ID.Valid || !task.AgentID.Valid {
		return
	}
	created, err := s.Queries.CreateComment(ctx, db.CreateCommentParams{
		ID:           dbid.NewV7(),
		IssueID:      issue.ID,
		WorkspaceID:  issue.WorkspaceID,
		AuthorType:   "agent",
		AuthorID:     task.AgentID,
		Content:      groupchat.ThinkingMessage,
		Type:         "comment",
		SourceTaskID: task.ID,
		RefMessageID: task.TriggerCommentID,
	})
	if err != nil {
		slog.Warn("group chat thinking comment was not posted", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	s.storeGroupChatPlaceholder(ctx, task.ID, groupchat.Placeholder{
		CommentID: util.UUIDToString(created.ID),
		Open:      true,
	})
	s.publishGroupChatComment(issue, created.Comment(), protocol.EventCommentCreated, groupchat.PayloadPlaceholder)
}

// groupChatParent is the parent a new comment on the issue may carry. Group
// chat messages are always top-level; they are never threaded.
func groupChatParent(ctx context.Context, q *db.Queries, issueID, parentID pgtype.UUID) pgtype.UUID {
	if !parentID.Valid {
		return parentID
	}
	if has, err := q.IssueHasMembers(ctx, issueID); err == nil && has {
		return pgtype.UUID{}
	}
	return parentID
}

func groupChatPlaceholder(raw []byte) bool {
	return strings.Contains(string(raw), "group_chat_placeholder")
}

// deliverGroupChatReply posts the run's final output as a new message when the
// agent did not already reply, and removes the thinking bubble. A second
// message is not created once that reply exists.
func (s *TaskService) deliverGroupChatReply(ctx context.Context, task db.AgentTaskQueue, result []byte) {
	fresh, err := s.Queries.GetAgentTask(ctx, task.ID)
	if err != nil {
		return
	}
	placeholder, ok := groupchat.OpenPlaceholder(fresh.Context)
	if !ok {
		return
	}
	body := groupChatReplyBody(task, result)
	if body == "" {
		return
	}
	commentID, err := util.ParseUUID(placeholder.CommentID)
	if err != nil {
		return
	}
	existing, err := s.Queries.GetComment(ctx, commentID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return
		}
		// The bubble was removed but the reply was not saved. Post the output
		// unless this run already left a message of its own.
		if s.agentCommentedSinceStart(ctx, fresh) {
			s.CloseGroupChatPlaceholder(ctx, fresh.ID, placeholder.CommentID)
			return
		}
		s.createAgentComment(ctx, fresh.IssueID, fresh.AgentID, body, "comment", fresh.TriggerCommentID, fresh.ID)
		if s.agentCommentedSinceStart(ctx, fresh) {
			s.CloseGroupChatPlaceholder(ctx, fresh.ID, placeholder.CommentID)
		}
		return
	}
	if !sameID(existing.AuthorID, fresh.AgentID) {
		return
	}
	if existing.Content != groupchat.ThinkingMessage {
		s.CloseGroupChatPlaceholder(ctx, fresh.ID, placeholder.CommentID)
		return
	}
	s.replaceGroupChatThinking(ctx, fresh, existing, body)
}

func (s *TaskService) agentCommentedSinceStart(ctx context.Context, task db.AgentTaskQueue) bool {
	commented, err := s.Queries.HasAgentCommentedSince(ctx, db.HasAgentCommentedSinceParams{
		IssueID:  task.IssueID,
		AuthorID: task.AgentID,
		Since:    task.StartedAt,
	})
	return err == nil && commented
}

// replaceGroupChatThinking removes the thinking bubble and inserts the finished
// text as its own message. Unread counts follow that new comment.
func (s *TaskService) replaceGroupChatThinking(ctx context.Context, task db.AgentTaskQueue, existing db.Comment, content string) bool {
	if strings.TrimSpace(content) == "" {
		return false
	}
	source := existing.SourceTaskID
	if !source.Valid {
		source = task.ID
	}
	var created db.CreateCommentRow
	err := s.runInTx(ctx, func(q *db.Queries) error {
		row, err := q.CreateComment(ctx, db.CreateCommentParams{
			ID:           dbid.NewV7(),
			IssueID:      existing.IssueID,
			WorkspaceID:  existing.WorkspaceID,
			AuthorType:   "agent",
			AuthorID:     existing.AuthorID,
			Content:      content,
			Type:         "comment",
			SourceTaskID: source,
			RefMessageID: existing.RefMessageID,
		})
		if err != nil {
			return err
		}
		if _, err := q.DeleteLeafComment(ctx, db.DeleteLeafCommentParams{
			ID:          existing.ID,
			WorkspaceID: existing.WorkspaceID,
		}); err != nil {
			return err
		}
		if _, err := q.TouchIssueForCommentDelete(ctx, db.TouchIssueForCommentDeleteParams{
			IssueID:     existing.IssueID,
			WorkspaceID: existing.WorkspaceID,
		}); err != nil {
			return err
		}
		created = row
		return nil
	})
	if err != nil {
		slog.Warn("group chat reply was not posted", "task_id", util.UUIDToString(task.ID), "error", err)
		return false
	}
	s.CloseGroupChatPlaceholder(ctx, task.ID, util.UUIDToString(existing.ID))
	issue, err := s.Queries.GetIssue(ctx, existing.IssueID)
	if err != nil {
		return true
	}
	s.publishGroupChatCommentDeleted(issue, existing)
	s.publishGroupChatComment(issue, created.Comment(), protocol.EventCommentCreated, "")
	return true
}

func groupChatReplyBody(task db.AgentTaskQueue, result []byte) string {
	var payload protocol.TaskCompletedPayload
	if err := json.Unmarshal(result, &payload); err != nil || payload.Output == "" {
		return ""
	}
	body := util.UnescapeBackslashEscapes(payload.Output)
	if task.TriggerCommentID.Valid && isTrivialDoneOutput(body) {
		return ""
	}
	return truncateFallbackCommentBody(redact.Text(body), maxSynthesizedFallbackCommentRunes)
}

// settleGroupChatThinking removes a thinking bubble the run never filled and
// posts the outcome as a new message, so the chat can show unread.
func (s *TaskService) settleGroupChatThinking(ctx context.Context, task db.AgentTaskQueue) {
	if !strings.Contains(string(task.Context), "group_chat_placeholder") {
		return
	}
	fresh, err := s.Queries.GetAgentTask(ctx, task.ID)
	if err != nil {
		return
	}
	placeholder, ok := groupchat.OpenPlaceholder(fresh.Context)
	if !ok {
		return
	}
	commentID, err := util.ParseUUID(placeholder.CommentID)
	if err != nil {
		s.storeGroupChatPlaceholder(ctx, task.ID, groupchat.Placeholder{CommentID: placeholder.CommentID, Open: false})
		return
	}
	existing, err := s.Queries.GetComment(ctx, commentID)
	if err != nil {
		s.storeGroupChatPlaceholder(ctx, task.ID, groupchat.Placeholder{CommentID: placeholder.CommentID, Open: false})
		return
	}
	if existing.Content == groupchat.ThinkingMessage && sameID(existing.AuthorID, fresh.AgentID) {
		if s.replaceGroupChatThinking(ctx, fresh, existing, groupchat.OutcomeMessage(groupchat.RunOutcome{
			Status:          fresh.Status,
			FailureReason:   fresh.FailureReason.String,
			CancelledByType: fresh.CancelledByType.String,
			CancelledByName: fresh.CancelledByName.String,
		})) {
			return
		}
		slog.Warn("group chat thinking comment was not closed", "task_id", util.UUIDToString(task.ID))
	}
	s.storeGroupChatPlaceholder(ctx, task.ID, groupchat.Placeholder{CommentID: placeholder.CommentID, Open: false})
}

func sameID(a, b pgtype.UUID) bool {
	return a.Valid && b.Valid && util.UUIDToString(a) == util.UUIDToString(b)
}

// PostGroupChatCancelledNotice records that an unfinished request was
// cancelled. The content quotes the trigger message from that moment.
func (s *TaskService) PostGroupChatCancelledNotice(ctx context.Context, issue db.Issue, triggerCommentID pgtype.UUID, trigger string) {
	created, err := s.Queries.CreateComment(ctx, db.CreateCommentParams{
		ID:           dbid.NewV7(),
		IssueID:      issue.ID,
		WorkspaceID:  issue.WorkspaceID,
		AuthorType:   "system",
		AuthorID:     pgtype.UUID{Valid: true},
		Content:      groupchat.CancelledNotice(trigger),
		Type:         "system",
		RefMessageID: triggerCommentID,
	})
	if err != nil {
		slog.Warn("group chat cancellation notice was not posted", "issue_id", util.UUIDToString(issue.ID), "error", err)
		return
	}
	s.publishGroupChatSystemComment(issue, created.Comment())
}

func (s *TaskService) publishGroupChatSystemComment(issue db.Issue, comment db.Comment) {
	if s.Bus == nil {
		return
	}
	fields := commentEventFields(comment)
	fields["revision"] = comment.Revision
	s.Bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: util.UUIDToString(issue.WorkspaceID),
		ActorType:   "system",
		Payload: map[string]any{
			"comment":      fields,
			"issue_title":  issue.Title,
			"issue_status": issue.Status,
		},
	})
}

// CloseGroupChatPlaceholder marks the thinking bubble as filled so a later
// comment from the same run is stored on its own.
func (s *TaskService) CloseGroupChatPlaceholder(ctx context.Context, taskID pgtype.UUID, commentID string) {
	s.storeGroupChatPlaceholder(ctx, taskID, groupchat.Placeholder{CommentID: commentID, Open: false})
}

// ReopenGroupChatPlaceholder undoes CloseGroupChatPlaceholder when the run
// that owns the bubble keeps going.
func (s *TaskService) ReopenGroupChatPlaceholder(ctx context.Context, taskID pgtype.UUID, commentID string) {
	s.storeGroupChatPlaceholder(ctx, taskID, groupchat.Placeholder{CommentID: commentID, Open: true})
}

func (s *TaskService) storeGroupChatPlaceholder(ctx context.Context, taskID pgtype.UUID, placeholder groupchat.Placeholder) {
	raw, err := json.Marshal(placeholder)
	if err != nil {
		return
	}
	if err := s.Queries.SetGroupChatPlaceholder(ctx, db.SetGroupChatPlaceholderParams{ID: taskID, Placeholder: raw}); err != nil {
		slog.Warn("group chat placeholder was not stored", "task_id", util.UUIDToString(taskID), "error", err)
	}
}

// publishGroupChatComment broadcasts a group-chat comment write. flag is
// groupchat.PayloadPlaceholder when the thinking bubble opens. An empty flag
// is a normal comment, which is what marks the chat unread.
func (s *TaskService) publishGroupChatComment(issue db.Issue, comment db.Comment, eventType, flag string) {
	if s.Bus == nil {
		return
	}
	fields := commentEventFields(comment)
	fields["revision"] = comment.Revision
	payload := map[string]any{
		"comment":      fields,
		"issue_title":  issue.Title,
		"issue_status": issue.Status,
	}
	if flag != "" {
		payload[flag] = true
	}
	s.Bus.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: util.UUIDToString(issue.WorkspaceID),
		ActorType:   "agent",
		ActorID:     util.UUIDToString(comment.AuthorID),
		Payload:     payload,
	})
}

func (s *TaskService) publishGroupChatCommentDeleted(issue db.Issue, comment db.Comment) {
	if s.Bus == nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventCommentDeleted,
		WorkspaceID: util.UUIDToString(issue.WorkspaceID),
		ActorType:   "agent",
		ActorID:     util.UUIDToString(comment.AuthorID),
		Payload: map[string]any{
			"comment_id": util.UUIDToString(comment.ID),
			"issue_id":   util.UUIDToString(issue.ID),
		},
	})
}
