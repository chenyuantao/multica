package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

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

// deliverGroupChatReply writes a run's final output into the thinking bubble
// when the agent did not already replace it. It never inserts a second comment.
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
	if err != nil || existing.Content != groupchat.ThinkingMessage || !sameID(existing.AuthorID, fresh.AgentID) {
		return
	}
	updated, err := s.Queries.UpdateComment(ctx, db.UpdateCommentParams{
		ID:           existing.ID,
		Content:      body,
		SourceTaskID: existing.SourceTaskID,
	})
	if err != nil {
		slog.Warn("group chat reply was not written into the thinking comment", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	s.CloseGroupChatPlaceholder(ctx, task.ID, placeholder.CommentID)
	if issue, err := s.Queries.GetIssue(ctx, existing.IssueID); err == nil {
		s.publishGroupChatComment(issue, updated.Comment(), protocol.EventCommentUpdated, groupchat.PayloadReply)
	}
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

// settleGroupChatThinking replaces a thinking bubble that the run never filled.
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
		updated, err := s.Queries.UpdateComment(ctx, db.UpdateCommentParams{
			ID: existing.ID,
			Content: groupchat.OutcomeMessage(groupchat.RunOutcome{
				Status:          fresh.Status,
				FailureReason:   fresh.FailureReason.String,
				CancelledByType: fresh.CancelledByType.String,
				CancelledByName: fresh.CancelledByName.String,
			}),
			SourceTaskID: existing.SourceTaskID,
		})
		if err != nil {
			slog.Warn("group chat thinking comment was not closed", "task_id", util.UUIDToString(task.ID), "error", err)
			return
		}
		if issue, err := s.Queries.GetIssue(ctx, existing.IssueID); err == nil {
			s.publishGroupChatComment(issue, updated.Comment(), protocol.EventCommentUpdated, groupchat.PayloadReply)
		}
	}
	s.storeGroupChatPlaceholder(ctx, task.ID, groupchat.Placeholder{CommentID: placeholder.CommentID, Open: false})
}

func sameID(a, b pgtype.UUID) bool {
	return a.Valid && b.Valid && util.UUIDToString(a) == util.UUIDToString(b)
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

// publishGroupChatComment broadcasts a thinking-bubble write. flag is
// groupchat.PayloadPlaceholder when the bubble opens and
// groupchat.PayloadReply when its final text lands.
func (s *TaskService) publishGroupChatComment(issue db.Issue, comment db.Comment, eventType, flag string) {
	if s.Bus == nil {
		return
	}
	fields := commentEventFields(comment)
	fields["revision"] = comment.Revision
	s.Bus.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: util.UUIDToString(issue.WorkspaceID),
		ActorType:   "agent",
		ActorID:     util.UUIDToString(comment.AuthorID),
		Payload: map[string]any{
			"comment":      fields,
			"issue_title":  issue.Title,
			"issue_status": issue.Status,
			flag:           true,
		},
	})
}
