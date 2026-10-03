package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/integrations/wechatclaw"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// ViaChannelWechatClaw marks a message the user sent from their WeChat Claw.
const ViaChannelWechatClaw = "wechat_claw"

const (
	// wechatClawStatusWait bounds one status request; iLink holds the poll
	// open while nothing changes and the client simply asks again.
	wechatClawStatusWait = 25 * time.Second
	// wechatClawLoginTTL matches how long a WeChat login QR stays scannable.
	wechatClawLoginTTL = 10 * time.Minute

	wechatClawTypingRefresh = 8 * time.Second
	wechatClawTypingMax     = 15 * time.Minute
)

// Copy sent back to WeChat. The chat there is Chinese-only.
const (
	wechatClawDispatchedText     = "已分发给%s执行中..."
	wechatClawWorkspaceGoneText  = "绑定的工作区已不可用，请在 Multica 个人设置中重新绑定微信 Claw。"
	wechatClawNoAgentText        = "当前工作区没有可以回答的智能体。"
	wechatClawUndecidedText      = "暂时无法分配智能体，请稍后再试。"
	wechatClawTooLongText        = "消息过长，请精简到 2000 字以内。"
	wechatClawSendFailedText     = "消息未能发送到 Multica，请稍后再试。"
	wechatClawEmptyReplyFallback = "(回复不含文字内容，请在 Multica 中查看)"
)

// WechatClawService holds the WeChat Claw runtime state. Handler is copied
// by value for read snapshots, so this lives behind a pointer.
type WechatClawService struct {
	Box *secretbox.Box
	// typing maps a WeChat-sourced message id to the stop of its typing
	// indicator, closed once the agent's reply is relayed by this replica.
	typing sync.Map
}

func NewWechatClawService(box *secretbox.Box) *WechatClawService {
	return &WechatClawService{Box: box}
}

type viaChannelCtxKey struct{}

// withViaChannel marks the comments this in-process request creates as
// having arrived through an external channel. It is never read from the
// request, so a client cannot claim it.
func withViaChannel(ctx context.Context, channel string) context.Context {
	return context.WithValue(ctx, viaChannelCtxKey{}, channel)
}

func viaChannelFromContext(ctx context.Context) pgtype.Text {
	channel, _ := ctx.Value(viaChannelCtxKey{}).(string)
	return pgtype.Text{String: channel, Valid: channel != ""}
}

// ── Binding API ─────────────────────────────────────────────────────────────

type WechatClawBindingResponse struct {
	WorkspaceID   string `json:"workspace_id"`
	WorkspaceName string `json:"workspace_name"`
	WorkspaceSlug string `json:"workspace_slug"`
	BoundAt       string `json:"bound_at"`
}

type WechatClawStatusResponse struct {
	// Available is false when this deployment has no WeChat Claw key.
	Available bool                       `json:"available"`
	Binding   *WechatClawBindingResponse `json:"binding"`
}

type CreateWechatClawQRCodeRequest struct {
	WorkspaceID string `json:"workspace_id"`
}

type WechatClawQRCodeResponse struct {
	QRCode string `json:"qrcode"`
	// URL is what the QR encodes; WeChat opens it when scanned.
	URL string `json:"url"`
}

type WechatClawQRCodeStatusResponse struct {
	// Status is wait, scanned, confirmed or expired.
	Status  string                     `json:"status"`
	Binding *WechatClawBindingResponse `json:"binding,omitempty"`
}

func (h *Handler) wechatClawBindingResponse(ctx context.Context, b db.WechatClawBinding) *WechatClawBindingResponse {
	resp := &WechatClawBindingResponse{
		WorkspaceID: uuidToString(b.WorkspaceID),
		BoundAt:     timestampToString(b.CreatedAt),
	}
	if ws, err := h.Queries.GetWorkspace(ctx, b.WorkspaceID); err == nil {
		resp.WorkspaceName = ws.Name
		resp.WorkspaceSlug = ws.Slug
	}
	return resp
}

func (h *Handler) GetWechatClaw(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	resp := WechatClawStatusResponse{Available: h.WechatClaw != nil}
	binding, err := h.Queries.GetWechatClawBinding(r.Context(), parseUUID(userID))
	switch {
	case err == nil:
		resp.Binding = h.wechatClawBindingResponse(r.Context(), binding)
	case !errors.Is(err, pgx.ErrNoRows):
		writeError(w, http.StatusInternalServerError, "failed to load wechat claw binding")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateWechatClawQRCode(w http.ResponseWriter, r *http.Request) {
	if h.WechatClaw == nil {
		writeFeatureDisabled(w, "wechat_claw_unavailable", "wechat claw is not configured")
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var req CreateWechatClawQRCodeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	workspaceID, ok := parseUUIDOrBadRequest(w, req.WorkspaceID, "workspace_id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
		UserID: parseUUID(userID), WorkspaceID: workspaceID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	qr, err := wechatclaw.NewClient("", "", "").FetchQRCode(r.Context())
	if err != nil {
		slog.Warn("wechat claw qrcode failed", append(logger.RequestAttrs(r), "error", err)...)
		writeErrorCode(w, http.StatusBadGateway, "wechat_claw_qrcode_failed", "couldn't get a WeChat QR code")
		return
	}
	if err := h.Queries.DeleteWechatClawLoginsForUser(r.Context(), parseUUID(userID)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start wechat claw login")
		return
	}
	if err := h.Queries.CreateWechatClawLogin(r.Context(), db.CreateWechatClawLoginParams{
		Qrcode: qr.QRCode, UserID: parseUUID(userID), WorkspaceID: workspaceID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start wechat claw login")
		return
	}
	writeJSON(w, http.StatusOK, WechatClawQRCodeResponse{QRCode: qr.QRCode, URL: qr.ImageContent})
}

// GetWechatClawQRCodeStatus waits up to wechatClawStatusWait for the QR to be
// scanned or confirmed. On confirmation it stores the bot and binds it to the
// workspace the QR was created for.
func (h *Handler) GetWechatClawQRCodeStatus(w http.ResponseWriter, r *http.Request) {
	if h.WechatClaw == nil {
		writeFeatureDisabled(w, "wechat_claw_unavailable", "wechat claw is not configured")
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	qrcode := strings.TrimSpace(r.URL.Query().Get("qrcode"))
	login, err := h.Queries.GetWechatClawLogin(r.Context(), db.GetWechatClawLoginParams{Qrcode: qrcode, UserID: parseUUID(userID)})
	if err != nil {
		writeError(w, http.StatusNotFound, "login not found")
		return
	}
	if login.CreatedAt.Valid && time.Since(login.CreatedAt.Time) > wechatClawLoginTTL {
		_ = h.Queries.DeleteWechatClawLogin(r.Context(), qrcode)
		writeJSON(w, http.StatusOK, WechatClawQRCodeStatusResponse{Status: "expired"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), wechatClawStatusWait)
	defer cancel()
	status, err := wechatclaw.NewClient("", "", "").QRCodeStatus(ctx, qrcode)
	if err != nil {
		if r.Context().Err() != nil {
			return
		}
		// An unanswered long poll is the normal "still waiting".
		writeJSON(w, http.StatusOK, WechatClawQRCodeStatusResponse{Status: "wait"})
		return
	}
	switch status.Status {
	case wechatclaw.QRStatusScanned:
		writeJSON(w, http.StatusOK, WechatClawQRCodeStatusResponse{Status: "scanned"})
	case wechatclaw.QRStatusExpired:
		_ = h.Queries.DeleteWechatClawLogin(r.Context(), qrcode)
		writeJSON(w, http.StatusOK, WechatClawQRCodeStatusResponse{Status: "expired"})
	case wechatclaw.QRStatusConfirmed:
		h.confirmWechatClawLogin(w, r, login, status)
	default:
		writeJSON(w, http.StatusOK, WechatClawQRCodeStatusResponse{Status: "wait"})
	}
}

func (h *Handler) confirmWechatClawLogin(w http.ResponseWriter, r *http.Request, login db.WechatClawLogin, status *wechatclaw.QRStatus) {
	ctx := r.Context()
	if status.BotToken == "" || status.ILinkBotID == "" {
		writeErrorCode(w, http.StatusBadGateway, "wechat_claw_login_failed", "WeChat did not return a bot")
		return
	}
	if _, err := h.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID: login.UserID, WorkspaceID: login.WorkspaceID,
	}); err != nil {
		_ = h.Queries.DeleteWechatClawLogin(ctx, login.Qrcode)
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	sealed, err := wechatclaw.SealToken(h.WechatClaw.Box, status.BotToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store wechat claw binding")
		return
	}
	binding, err := h.Queries.UpsertWechatClawBinding(ctx, db.UpsertWechatClawBindingParams{
		UserID:            login.UserID,
		WorkspaceID:       login.WorkspaceID,
		BotTokenEncrypted: sealed,
		IlinkBotID:        status.ILinkBotID,
		IlinkUserID:       status.ILinkUserID,
		BaseUrl:           status.BaseURL,
	})
	if err != nil {
		slog.Warn("wechat claw binding failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to store wechat claw binding")
		return
	}
	_ = h.Queries.DeleteWechatClawLogin(ctx, login.Qrcode)
	slog.Info("wechat claw bound", append(logger.RequestAttrs(r), "workspace_id", uuidToString(binding.WorkspaceID))...)
	writeJSON(w, http.StatusOK, WechatClawQRCodeStatusResponse{Status: "confirmed", Binding: h.wechatClawBindingResponse(ctx, binding)})
}

func (h *Handler) DeleteWechatClaw(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if err := h.Queries.DeleteWechatClawBinding(r.Context(), parseUUID(userID)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove wechat claw binding")
		return
	}
	_ = h.Queries.DeleteWechatClawLoginsForUser(r.Context(), parseUUID(userID))
	w.WriteHeader(http.StatusNoContent)
}

// ── Inbound: WeChat → Ask AI ────────────────────────────────────────────────

// HandleWechatClawMessage asks AI with a text message the user sent their
// bot, exactly as the Ask AI box would: Jev picks the agent, the question
// goes to the user's direct chat with it, and that agent's reply is relayed
// back by RelayWechatClawReply. A message without text is not a trigger.
func (h *Handler) HandleWechatClawMessage(ctx context.Context, binding db.WechatClawBinding, client *wechatclaw.Client, msg wechatclaw.Message) {
	if h.WechatClaw == nil || msg.MessageType != wechatclaw.MessageTypeUser || msg.MessageState != wechatclaw.MessageStateFinish {
		return
	}
	if binding.IlinkUserID != "" && msg.FromUserID != binding.IlinkUserID {
		return
	}
	current, err := h.Queries.GetWechatClawBinding(ctx, binding.UserID)
	if err != nil || current.IlinkBotID != binding.IlinkBotID {
		return
	}
	if msg.ContextToken != "" && msg.ContextToken != current.ContextToken {
		if err := h.Queries.SetWechatClawContextToken(ctx, db.SetWechatClawContextTokenParams{
			UserID: current.UserID, IlinkBotID: current.IlinkBotID, ContextToken: msg.ContextToken,
		}); err != nil {
			slog.Warn("wechat claw context token not saved", "user_id", uuidToString(current.UserID), "error", err)
		}
	}
	text := msg.Text()
	if text == "" {
		return
	}
	log := slog.With("user_id", uuidToString(current.UserID), "workspace_id", uuidToString(current.WorkspaceID))
	reply := func(s string) {
		if err := client.SendText(ctx, msg.FromUserID, msg.ContextToken, s); err != nil {
			log.Warn("wechat claw reply failed", "error", err)
		}
	}

	member, err := h.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID: current.UserID, WorkspaceID: current.WorkspaceID,
	})
	if err != nil {
		reply(wechatClawWorkspaceGoneText)
		return
	}
	call := func(ctx context.Context, fn http.HandlerFunc, path string, params map[string]string, body any) (int, []byte) {
		return h.serveAsMember(ctx, member, fn, path, params, body)
	}

	status, raw := call(ctx, h.AskAI, "/api/group-chats/ask", nil, AskAIRequest{Query: text})
	var asked AskAIResponse
	if status != http.StatusOK || json.Unmarshal(raw, &asked) != nil || asked.AgentID == "" {
		log.Info("wechat claw ask ai declined", "status", status, "body", strings.TrimSpace(string(raw)))
		switch status {
		case http.StatusUnprocessableEntity:
			reply(wechatClawNoAgentText)
		case http.StatusBadRequest:
			reply(wechatClawTooLongText)
		default:
			reply(wechatClawUndecidedText)
		}
		return
	}
	agentID, err := util.ParseUUID(asked.AgentID)
	if err != nil {
		reply(wechatClawUndecidedText)
		return
	}
	agentName := asked.AgentID
	if agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: agentID, WorkspaceID: member.WorkspaceID}); err == nil {
		agentName = agent.Name
	}
	reply(fmt.Sprintf(wechatClawDispatchedText, agentName))
	stopTyping := h.startWechatClawTyping(ctx, client, msg)

	status, raw = call(ctx, h.OpenDirectGroupChat, "/api/group-chats/direct", nil, map[string]string{
		"member_type": "agent", "member_id": asked.AgentID,
	})
	var chat struct {
		ID string `json:"id"`
	}
	if (status != http.StatusOK && status != http.StatusCreated) || json.Unmarshal(raw, &chat) != nil || chat.ID == "" {
		stopTyping()
		log.Warn("wechat claw direct chat failed", "status", status, "body", strings.TrimSpace(string(raw)))
		reply(wechatClawSendFailedText)
		return
	}

	status, raw = call(withViaChannel(ctx, ViaChannelWechatClaw), h.CreateComment, "/api/issues/"+chat.ID+"/comments",
		map[string]string{"id": chat.ID}, CreateCommentRequest{Content: text})
	var comment struct {
		ID string `json:"id"`
	}
	if status != http.StatusCreated || json.Unmarshal(raw, &comment) != nil || comment.ID == "" {
		stopTyping()
		log.Warn("wechat claw message failed", "status", status, "body", strings.TrimSpace(string(raw)))
		reply(wechatClawSendFailedText)
		return
	}
	h.keepWechatClawTyping(ctx, chat.ID, comment.ID, stopTyping)
}

// serveAsMember runs a handler in-process as the member, the way their own
// browser request would reach it after the auth and workspace middleware.
func (h *Handler) serveAsMember(ctx context.Context, member db.Member, fn http.HandlerFunc, path string, params map[string]string, body any) (int, []byte) {
	raw, err := json.Marshal(body)
	if err != nil {
		return http.StatusInternalServerError, nil
	}
	workspaceID := uuidToString(member.WorkspaceID)
	ctx = middleware.SetMemberContext(ctx, workspaceID, member)
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, path, bytes.NewReader(raw))
	if err != nil {
		return http.StatusInternalServerError, nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", uuidToString(member.UserID))
	req.Header.Set("X-Workspace-ID", workspaceID)
	rec := &bufferedResponse{header: http.Header{}, status: http.StatusOK}
	fn(rec, req)
	return rec.status, rec.body.Bytes()
}

type bufferedResponse struct {
	header http.Header
	status int
	wrote  bool
	body   bytes.Buffer
}

func (b *bufferedResponse) Header() http.Header { return b.header }

func (b *bufferedResponse) WriteHeader(status int) {
	if !b.wrote {
		b.status, b.wrote = status, true
	}
}

func (b *bufferedResponse) Write(p []byte) (int, error) {
	b.wrote = true
	return b.body.Write(p)
}

// startWechatClawTyping shows "typing" in the WeChat chat and returns the
// function that clears it. Failures only cost the indicator.
func (h *Handler) startWechatClawTyping(ctx context.Context, client *wechatclaw.Client, msg wechatclaw.Message) func() {
	ticket, err := client.TypingTicket(ctx, msg.FromUserID, msg.ContextToken)
	if err != nil {
		slog.Debug("wechat claw typing unavailable", "error", err)
		return func() {}
	}
	send := func(status int) {
		if err := client.SendTyping(context.WithoutCancel(ctx), msg.FromUserID, ticket, status); err != nil {
			slog.Debug("wechat claw typing failed", "error", err)
		}
	}
	send(wechatclaw.TypingStatusTyping)
	var once sync.Once
	stopped := make(chan struct{})
	go func() {
		ticker := time.NewTicker(wechatClawTypingRefresh)
		defer ticker.Stop()
		for {
			select {
			case <-stopped:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				send(wechatclaw.TypingStatusTyping)
			}
		}
	}()
	return func() {
		once.Do(func() {
			close(stopped)
			send(wechatclaw.TypingStatusCancel)
		})
	}
}

// keepWechatClawTyping clears the indicator when this replica relays the
// reply, when the chat has no run left (the reply was relayed elsewhere, or
// the run ended without one), or after wechatClawTypingMax.
func (h *Handler) keepWechatClawTyping(ctx context.Context, chatID, commentID string, stop func()) {
	done := make(chan struct{})
	h.WechatClaw.typing.Store(commentID, done)
	defer h.WechatClaw.typing.Delete(commentID)
	defer stop()
	chat, err := util.ParseUUID(chatID)
	if err != nil {
		return
	}
	deadline := time.NewTimer(wechatClawTypingMax)
	defer deadline.Stop()
	ticker := time.NewTicker(wechatClawTypingRefresh)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		case <-deadline.C:
			return
		case <-ticker.C:
			tasks, err := h.Queries.ListActiveTasksForIssues(ctx, []pgtype.UUID{chat})
			if err == nil && len(tasks) == 0 {
				return
			}
		}
	}
}

// ── Outbound: agent reply → WeChat ──────────────────────────────────────────

type wechatClawReplyEvent struct {
	ID           string  `json:"id"`
	IssueID      string  `json:"issue_id"`
	AuthorType   string  `json:"author_type"`
	Content      string  `json:"content"`
	Type         string  `json:"type"`
	RefMessageID *string `json:"ref_message_id"`
	SourceTaskID *string `json:"source_task_id"`
}

// RelayWechatClawReply copies an agent's chat reply to WeChat when the
// message it answers came from the asker's WeChat Claw. The thinking bubble
// is not a reply; the message that replaces it is.
func (h *Handler) RelayWechatClawReply(e events.Event) {
	if h.WechatClaw == nil || e.ActorType != "agent" {
		return
	}
	payload, ok := e.Payload.(map[string]any)
	if !ok {
		return
	}
	if flag, _ := payload[groupchat.PayloadPlaceholder].(bool); flag {
		return
	}
	raw, err := json.Marshal(payload["comment"])
	if err != nil {
		return
	}
	var reply wechatClawReplyEvent
	if json.Unmarshal(raw, &reply) != nil || reply.AuthorType != "agent" || reply.Type != "comment" {
		return
	}
	if reply.Content == groupchat.ThinkingMessage {
		return
	}
	go h.relayWechatClawReply(context.Background(), e.WorkspaceID, reply)
}

func (h *Handler) relayWechatClawReply(ctx context.Context, workspaceID string, reply wechatClawReplyEvent) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	wsID, err := util.ParseUUID(workspaceID)
	if err != nil {
		return
	}
	question, ok := h.wechatClawQuestion(ctx, wsID, reply)
	if !ok {
		return
	}
	if done, ok := h.WechatClaw.typing.LoadAndDelete(uuidToString(question.ID)); ok {
		close(done.(chan struct{}))
	}
	binding, err := h.Queries.GetWechatClawBinding(ctx, question.AuthorID)
	if err != nil || uuidToString(binding.WorkspaceID) != workspaceID {
		return
	}
	client, err := wechatclaw.ClientFor(h.WechatClaw.Box, binding)
	if err != nil {
		slog.Warn("wechat claw bot token unreadable", "user_id", uuidToString(binding.UserID), "error", err)
		return
	}
	text := wechatclaw.MarkdownToPlainText(reply.Content)
	if text == "" {
		text = wechatClawEmptyReplyFallback
	}
	if err := client.SendText(ctx, binding.IlinkUserID, binding.ContextToken, text); err != nil {
		slog.Warn("wechat claw relay failed", "user_id", uuidToString(binding.UserID), "comment_id", reply.ID, "error", err)
	}
}

// wechatClawQuestion finds the member message an agent reply answers: the
// message it quotes, or else the trigger of the run that wrote it. Only a
// message that came from WeChat Claw qualifies.
func (h *Handler) wechatClawQuestion(ctx context.Context, wsID pgtype.UUID, reply wechatClawReplyEvent) (db.Comment, bool) {
	var candidates []pgtype.UUID
	if reply.RefMessageID != nil {
		if id, err := util.ParseUUID(*reply.RefMessageID); err == nil {
			candidates = append(candidates, id)
		}
	}
	if reply.SourceTaskID != nil {
		if id, err := util.ParseUUID(*reply.SourceTaskID); err == nil {
			if task, err := h.Queries.GetAgentTask(ctx, id); err == nil && task.TriggerCommentID.Valid {
				candidates = append(candidates, task.TriggerCommentID)
			}
		}
	}
	for _, id := range candidates {
		comment, err := h.Queries.GetCommentInWorkspace(ctx, db.GetCommentInWorkspaceParams{ID: id, WorkspaceID: wsID})
		if err != nil {
			continue
		}
		if comment.AuthorType == "member" && comment.ViaChannel.String == ViaChannelWechatClaw && uuidToString(comment.IssueID) == reply.IssueID {
			return comment, true
		}
	}
	return db.Comment{}, false
}
