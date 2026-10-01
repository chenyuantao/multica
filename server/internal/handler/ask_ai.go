package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	askAIQueryMaxRunes     = 2000
	askAIMaxAttachments    = 20
	askAIAttachmentNameMax = 255
)

type AskAIRequest struct {
	Query       string                    `json:"query"`
	Page        *groupchat.AskPage        `json:"page"`
	Attachments []groupchat.AskAttachment `json:"attachments"`
}

type AskAIResponse struct {
	AgentID string `json:"agent_id"`
}

// AskAI picks the agent that should answer the question in a direct chat
// with the requester. The planner sees the question, the page it was asked
// from, the names of any attached files, and every agent the requester may
// open a direct chat with. A question may be files alone.
func (h *Handler) AskAI(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req AskAIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Query = strings.TrimSpace(sanitizeNullBytes(req.Query))
	if req.Query == "" && len(req.Attachments) == 0 {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}
	if utf8.RuneCountInString(req.Query) > askAIQueryMaxRunes {
		writeError(w, http.StatusBadRequest, "query is too long")
		return
	}
	if len(req.Attachments) > askAIMaxAttachments {
		writeError(w, http.StatusBadRequest, "too many attachments")
		return
	}
	for i := range req.Attachments {
		req.Attachments[i].Name = trimRunes(sanitizeNullBytes(req.Attachments[i].Name), askAIAttachmentNameMax)
		req.Attachments[i].ContentType = trimRunes(sanitizeNullBytes(req.Attachments[i].ContentType), askAIAttachmentNameMax)
	}
	req.Page.Clamp()

	ctx := r.Context()
	agents, err := h.Queries.ListAgents(ctx, member.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agents")
		return
	}
	state := groupchat.AskState{Query: req.Query, Page: req.Page, Attachments: req.Attachments, Agents: []groupchat.AskAgent{}}
	workspaceID := uuidToString(member.WorkspaceID)
	for _, agent := range agents {
		if !h.memberCanWireAgent(ctx, member, agent, workspaceID) {
			continue
		}
		state.Agents = append(state.Agents, groupchat.AskAgent{
			ID:          uuidToString(agent.ID),
			Name:        agent.Name,
			Description: agent.Description,
		})
	}

	agentID, err := groupchat.ChooseAnswerer(ctx, h.GroupChatDecider, state)
	switch {
	case errors.Is(err, groupchat.ErrNoAnswerer):
		writeErrorCode(w, http.StatusUnprocessableEntity, "ask_ai_no_agent", "no agent can answer")
		return
	case err != nil:
		slog.Warn("ask ai undecided", append(logger.RequestAttrs(r), "error", err)...)
		writeErrorCode(w, http.StatusServiceUnavailable, "ask_ai_undecided", "couldn't choose an agent")
		return
	}
	writeJSON(w, http.StatusOK, AskAIResponse{AgentID: agentID})
}

// saveAskAIContext stores the page a group chat message was asked from. It
// runs before the message's agents are started, so their claim finds it. A
// failure leaves the message without the context rather than failing it.
func (h *Handler) saveAskAIContext(r *http.Request, comment db.Comment, page *groupchat.AskPage) {
	page.Clamp()
	if page.Empty() {
		return
	}
	raw, err := json.Marshal(page)
	if err != nil {
		return
	}
	if err := h.Queries.CreateCommentAskContext(r.Context(), db.CreateCommentAskContextParams{
		CommentID:   comment.ID,
		IssueID:     comment.IssueID,
		WorkspaceID: comment.WorkspaceID,
		Page:        raw,
	}); err != nil {
		slog.Warn("ask ai context was not saved", append(logger.RequestAttrs(r), "error", err, "comment_id", uuidToString(comment.ID))...)
	}
}

// attachAskAIContext appends, after the group transcript, the Ask AI page of
// every message this run answers, as <ask_ai_context> XML.
func (h *Handler) attachAskAIContext(ctx context.Context, resp *AgentTaskResponse, issue db.Issue, task db.AgentTaskQueue) {
	ids := append([]pgtype.UUID{}, task.CoalescedCommentIds...)
	if task.TriggerCommentID.Valid {
		ids = append(ids, task.TriggerCommentID)
	}
	if len(ids) == 0 {
		return
	}
	rows, err := h.Queries.ListCommentAskContexts(ctx, db.ListCommentAskContextsParams{WorkspaceID: issue.WorkspaceID, CommentIds: ids})
	if err != nil {
		slog.Warn("ask ai context could not be loaded", "task_id", uuidToString(task.ID), "error", err)
		return
	}
	question := h.askQuestionText(ctx, issue, task)
	byID := make(map[string]string, len(rows))
	for _, row := range rows {
		var page groupchat.AskPage
		if err := json.Unmarshal(row.Page, &page); err != nil {
			continue
		}
		id := uuidToString(row.CommentID)
		h.hideAskChatMessages(ctx, issue, task, &page, question)
		byID[id] = groupchat.RenderAskContext(id, &page)
	}
	blocks := make([]string, 0, len(byID))
	if resp.GroupChatTranscript != "" {
		blocks = append(blocks, resp.GroupChatTranscript)
	}
	for _, id := range ids {
		if block := byID[uuidToString(id)]; block != "" {
			blocks = append(blocks, block)
			delete(byID, uuidToString(id))
		}
	}
	resp.GroupChatTranscript = strings.Join(blocks, "\n\n")
}

func (h *Handler) askQuestionText(ctx context.Context, issue db.Issue, task db.AgentTaskQueue) string {
	if !task.TriggerCommentID.Valid {
		return ""
	}
	comment, err := h.Queries.GetCommentInWorkspace(ctx, db.GetCommentInWorkspaceParams{ID: task.TriggerCommentID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		return ""
	}
	return comment.Content
}

// hideAskChatMessages runs the same Jev filter on the chat that was open when
// someone asked AI. The agent is already chosen. The question and the message
// they asked about stay; a file stays because Jev cannot judge it.
func (h *Handler) hideAskChatMessages(ctx context.Context, issue db.Issue, task db.AgentTaskQueue, page *groupchat.AskPage, question string) {
	if page == nil || page.Chat == nil || len(page.Chat.Messages) == 0 {
		return
	}
	if h.GroupChatDecider == nil || !h.GroupChatDecider.Enabled() || !task.AgentID.Valid {
		return
	}
	roster, ok := h.groupChatRosterIfChat(ctx, issue)
	if !ok {
		return
	}
	agentID := uuidToString(task.AgentID)
	var card groupchat.Card
	found := false
	for _, person := range roster {
		if person.Type == "agent" && person.ID == agentID {
			card = groupchat.Card{ID: person.ID, Name: person.Name, Description: person.Description}
			found = true
			break
		}
	}
	if !found {
		return
	}
	excerpts := make([]groupchat.Excerpt, 0, len(page.Chat.Messages)+1)
	var attachmentIDs []pgtype.UUID
	for i, message := range page.Chat.Messages {
		excerpts = append(excerpts, groupchat.Excerpt{
			Turn:  groupchat.Turn{ID: message.ID, Author: message.Sender, Text: message.Content, Time: message.Time},
			Index: i,
		})
		if parsed, err := util.ParseUUID(message.ID); err == nil {
			attachmentIDs = append(attachmentIDs, parsed)
		}
	}
	if len(attachmentIDs) > 0 {
		rows, err := h.Queries.ListAttachmentsByCommentIDs(ctx, db.ListAttachmentsByCommentIDsParams{
			Column1: attachmentIDs, WorkspaceID: issue.WorkspaceID,
		})
		if err != nil {
			slog.Warn("ask ai attachments failed", "issue_id", uuidToString(issue.ID), "error", err)
			return
		}
		has := map[string]bool{}
		for _, row := range rows {
			if row.CommentID.Valid {
				has[uuidToString(row.CommentID)] = true
			}
		}
		for i := range excerpts {
			excerpts[i].Attachment = has[excerpts[i].ID]
		}
	}
	protected := map[string]bool{}
	if page.Selection != nil && strings.TrimSpace(page.Selection.MessageID) != "" {
		protected[page.Selection.MessageID] = true
	}
	if question = strings.TrimSpace(question); question != "" {
		excerpts = append(excerpts, groupchat.Excerpt{
			Turn:  groupchat.Turn{ID: "ask-question", Author: "user", Role: "member", Text: question},
			Index: len(excerpts),
		})
		protected["ask-question"] = true
	}
	hidden, err := groupchat.FilterForAgent(ctx, h.GroupChatDecider, card, excerpts, protected)
	if err != nil {
		slog.Warn("ask ai message filter failed", "issue_id", uuidToString(issue.ID), "agent_id", agentID, "error", err)
		return
	}
	for i := range page.Chat.Messages {
		id := page.Chat.Messages[i].ID
		if id != "" && hidden[id] {
			page.Chat.Messages[i].Content = groupchat.HiddenMessageText
		}
	}
}
