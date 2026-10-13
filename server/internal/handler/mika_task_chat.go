package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	mikaInstructionRunes = 400
	mikaTaskContentRunes = 8000
	mikaTaskTitleRunes   = 200
)

type mikaAgentCard struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Instructions  string   `json:"instructions"`
	Skills        []string `json:"skills"`
	Tools         []string `json:"tools"`
	RuntimeOnline bool     `json:"runtime_online"`
	UserCreated   bool     `json:"user_created"`
}

// ListMikaAgents returns the agents this person may put in a task group,
// with the facts Mika needs to choose one: duties, skills, tool names,
// whether the runtime is online, and whether the person created it.
func (h *Handler) ListMikaAgents(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	ctx := r.Context()
	agents, err := h.Queries.ListAgents(ctx, member.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agents")
		return
	}
	workspaceID := uuidToString(member.WorkspaceID)
	kept := make([]db.Agent, 0, len(agents))
	ids := make([]pgtype.UUID, 0, len(agents))
	runtimeIDs := make([]pgtype.UUID, 0, len(agents))
	for _, agent := range agents {
		if !h.memberCanWireAgent(ctx, member, agent, workspaceID) {
			continue
		}
		kept = append(kept, agent)
		ids = append(ids, agent.ID)
		if agent.RuntimeID.Valid {
			runtimeIDs = append(runtimeIDs, agent.RuntimeID)
		}
	}
	skills := map[string][]string{}
	if len(ids) > 0 {
		rows, err := h.Queries.ListAgentSkillNamesByAgentIDs(ctx, ids)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list agent skills")
			return
		}
		for _, row := range rows {
			id := uuidToString(row.AgentID)
			skills[id] = append(skills[id], row.Name)
		}
	}
	online := map[string]bool{}
	if len(runtimeIDs) > 0 {
		runtimes, err := h.Queries.GetAgentRuntimes(ctx, runtimeIDs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list agent runtimes")
			return
		}
		for _, runtime := range runtimes {
			online[uuidToString(runtime.ID)] = runtime.Status == "online"
		}
	}
	out := struct {
		Agents []mikaAgentCard `json:"agents"`
	}{Agents: make([]mikaAgentCard, 0, len(kept))}
	for _, agent := range kept {
		id := uuidToString(agent.ID)
		names := skills[id]
		if names == nil {
			names = []string{}
		}
		out.Agents = append(out.Agents, mikaAgentCard{
			ID:            id,
			Name:          agent.Name,
			Description:   agent.Description,
			Instructions:  mikaClip(agent.Instructions, mikaInstructionRunes),
			Skills:        names,
			Tools:         agentToolNames(agent),
			RuntimeOnline: agent.RuntimeID.Valid && online[uuidToString(agent.RuntimeID)],
			UserCreated:   !agent.SystemKey.Valid || strings.TrimSpace(agent.SystemKey.String) == "",
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func agentToolNames(agent db.Agent) []string {
	names := append([]string{}, agent.ComposioToolkitAllowlist...)
	var cfg map[string]json.RawMessage
	if len(agent.McpConfig) > 0 && json.Unmarshal(agent.McpConfig, &cfg) == nil {
		servers := cfg["mcpServers"]
		if servers == nil {
			servers = cfg["mcp_servers"]
		}
		var keyed map[string]json.RawMessage
		if json.Unmarshal(servers, &keyed) == nil {
			for name := range keyed {
				if strings.TrimSpace(name) != "" {
					names = append(names, name)
				}
			}
		}
	}
	if names == nil {
		return []string{}
	}
	return names
}

type mikaCandidatesRequest struct {
	Query string `json:"query"`
}

type mikaCandidateResponse struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Status       string  `json:"status"`
	LastMessage  string  `json:"last_message"`
	LastActivity string  `json:"last_activity"`
	Unfinished   float64 `json:"unfinished"`
	Recency      float64 `json:"recency"`
	Message      float64 `json:"message"`
	TitleScore   float64 `json:"title_score"`
	Score        float64 `json:"score"`
	Recommend    bool    `json:"recommend"`
}

// ListMikaTaskChatCandidates ranks the person's group chats for continuing
// this instruction. Unfinished, recent, and a similar last message come
// first. A similar title alone does not.
func (h *Handler) ListMikaTaskChatCandidates(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	var req mikaCandidatesRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Query = strings.TrimSpace(sanitizeNullBytes(req.Query))
	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}
	if utf8.RuneCountInString(req.Query) > askAIQueryMaxRunes {
		writeError(w, http.StatusBadRequest, "query is too long")
		return
	}
	ctx := r.Context()
	issues, err := h.Queries.ListGroupChatsForMember(ctx, db.ListGroupChatsForMemberParams{
		MemberType:  "member",
		MemberID:    parseUUID(userID),
		WorkspaceID: member.WorkspaceID,
		RowLimit:    groupChatListLimit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list chats")
		return
	}
	ids := make([]pgtype.UUID, 0, len(issues))
	open := make([]db.Issue, 0, len(issues))
	for _, issue := range issues {
		if issue.IsDirectChat || isReminder(issue) {
			continue
		}
		open = append(open, issue)
		ids = append(ids, issue.ID)
	}
	latest := map[string]db.Comment{}
	if len(ids) > 0 {
		rows, err := h.Queries.ListLatestCommentsForIssues(ctx, db.ListLatestCommentsForIssuesParams{
			WorkspaceID: member.WorkspaceID,
			IssueIds:    ids,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list chat messages")
			return
		}
		for _, row := range rows {
			latest[uuidToString(row.IssueID)] = row
		}
	}
	chats := make([]groupchat.ReuseChat, 0, len(open))
	for _, issue := range open {
		activity := issue.CreatedAt.Time
		if issue.LastCommentAt.Valid {
			activity = issue.LastCommentAt.Time
		}
		message := ""
		if last, ok := latest[uuidToString(issue.ID)]; ok {
			message = last.Content
			if last.CreatedAt.Valid {
				activity = last.CreatedAt.Time
			}
		}
		chats = append(chats, groupchat.ReuseChat{
			ID:           uuidToString(issue.ID),
			Title:        issue.Title,
			Status:       issue.Status,
			LastMessage:  message,
			LastActivity: activity,
		})
	}
	ranked := groupchat.RankReuse(req.Query, chats, time.Now())
	out := struct {
		Chats []mikaCandidateResponse `json:"chats"`
	}{Chats: make([]mikaCandidateResponse, 0, len(ranked))}
	for _, chat := range ranked {
		activity := ""
		if !chat.LastActivity.IsZero() {
			activity = chat.LastActivity.UTC().Format(time.RFC3339)
		}
		out.Chats = append(out.Chats, mikaCandidateResponse{
			ID:           chat.ID,
			Title:        chat.ReuseChat.Title,
			Status:       chat.Status,
			LastMessage:  mikaClip(chat.LastMessage, 280),
			LastActivity: activity,
			Unfinished:   chat.Unfinished,
			Recency:      chat.Recency,
			Message:      chat.Message,
			TitleScore:   chat.Title,
			Score:        chat.Score,
			Recommend:    chat.Recommend,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

type mikaStartRequest struct {
	ChatID         string               `json:"chat_id"`
	Title          string               `json:"title"`
	Members        []groupChatMemberRef `json:"members"`
	Content        string               `json:"content"`
	MentionAgentID string               `json:"mention_agent_id"`
}

// StartMikaTaskChat creates or reuses a task group and posts the instruction
// as the person, so the existing group-chat dispatch starts the named agent.
// The realtime event carries the comment that asked Mika, and the web client
// opens the group from that.
func (h *Handler) StartMikaTaskChat(w http.ResponseWriter, r *http.Request) {
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
	var req mikaStartRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Content = strings.TrimSpace(sanitizeNullBytes(req.Content))
	req.Title = strings.TrimSpace(sanitizeNullBytes(req.Title))
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if utf8.RuneCountInString(req.Content) > mikaTaskContentRunes {
		writeError(w, http.StatusBadRequest, "content is too long")
		return
	}
	if req.ChatID == "" && req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if utf8.RuneCountInString(req.Title) > mikaTaskTitleRunes {
		writeError(w, http.StatusBadRequest, "title is too long")
		return
	}
	req.MentionAgentID = strings.TrimSpace(req.MentionAgentID)
	if !h.allowMikaTaskDelegation(w, r, member.WorkspaceID, req) {
		return
	}

	refs, mentionName, ok := h.mikaTaskMembers(w, r, member, userID, req)
	if !ok {
		return
	}
	var issue db.Issue
	var members []db.IssueMember
	if req.ChatID == "" {
		issue, members, ok = h.createGroupChat(w, r, member, userID, req.Title, refs, false, true)
		if !ok {
			return
		}
	} else {
		issue, members, ok = h.reuseMikaTaskChat(w, r, member, userID, req.ChatID, refs)
		if !ok {
			return
		}
	}
	content := req.Content
	if req.MentionAgentID != "" && mentionName != "" {
		mention := fmt.Sprintf("[@%s](mention://agent/%s)", mentionName, req.MentionAgentID)
		if !strings.Contains(content, mention) {
			content = mention + " " + content
		}
	}
	message, ok := h.postMemberChatMessage(w, r, uuidToString(issue.ID), content)
	if !ok {
		return
	}
	h.publishMikaTaskChat(uuidToString(member.WorkspaceID), userID, issue.ID, h.mikaAskCommentID(r))
	fresh, err := h.Queries.GetIssueInWorkspace(r.Context(), db.GetIssueInWorkspaceParams{ID: issue.ID, WorkspaceID: issue.WorkspaceID})
	if err == nil {
		issue = fresh
	}
	members, err = h.Queries.ListIssueMembers(r.Context(), db.ListIssueMembersParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		members = nil
	}
	h.finishMikaTaskAfterHandoff(r, member.WorkspaceID, mentionName)
	writeJSON(w, http.StatusCreated, struct {
		Chat    GroupChatResponse `json:"chat"`
		Message CommentResponse   `json:"message"`
	}{
		Chat:    h.groupChatDetail(r.Context(), issue, members, userID),
		Message: message,
	})
}

const (
	mikaSelfDelegationError  = "a task group cannot be delegated to Mika"
	mikaMentionRequiredError = "mention_agent_id must name another agent"
)

// allowMikaTaskDelegation refuses a task group whose work would land on Mika.
// Naming her, or leaving the mention empty while she is the caller — which
// adds her as the only agent and the single-agent route then starts her —
// is the self-delegation that runs the same job twice.
func (h *Handler) allowMikaTaskDelegation(w http.ResponseWriter, r *http.Request, workspaceID pgtype.UUID, req mikaStartRequest) bool {
	if req.MentionAgentID != "" {
		mentionID, ok := parseUUIDOrBadRequest(w, req.MentionAgentID, "mention_agent_id")
		if !ok {
			return false
		}
		agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{ID: mentionID, WorkspaceID: workspaceID})
		if err != nil {
			writeError(w, http.StatusBadRequest, "agent not found in this workspace")
			return false
		}
		if agent.SystemKey.String == service.MikaSystemKey {
			writeError(w, http.StatusBadRequest, mikaSelfDelegationError)
			return false
		}
	}
	caller, ok := h.callingMikaAgent(r, workspaceID)
	if ok && req.MentionAgentID == "" {
		writeError(w, http.StatusBadRequest, mikaMentionRequiredError)
		return false
	}
	if ok && strings.Contains(req.Content, "mention://agent/"+uuidToString(caller.ID)) {
		writeError(w, http.StatusBadRequest, mikaSelfDelegationError)
		return false
	}
	return true
}

// callingMikaAgent is the built-in agent behind this task-token request.
func (h *Handler) callingMikaAgent(r *http.Request, workspaceID pgtype.UUID) (db.Agent, bool) {
	if r.Header.Get("X-Actor-Source") != "task_token" {
		return db.Agent{}, false
	}
	raw := strings.TrimSpace(r.Header.Get("X-Agent-ID"))
	if raw == "" {
		return db.Agent{}, false
	}
	agentID, err := util.ParseUUID(raw)
	if err != nil {
		return db.Agent{}, false
	}
	agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{ID: agentID, WorkspaceID: workspaceID})
	if err != nil || agent.SystemKey.String != service.MikaSystemKey {
		return db.Agent{}, false
	}
	return agent, true
}

// finishMikaTaskAfterHandoff completes Mika's originating run once the group
// message has been posted. The daemon sees the terminal status and stops the
// process; the named agent is already queued to do the work.
func (h *Handler) finishMikaTaskAfterHandoff(r *http.Request, workspaceID pgtype.UUID, workerName string) {
	if _, ok := h.callingMikaAgent(r, workspaceID); !ok {
		return
	}
	task, ok := h.taskFromRequestHeader(r)
	if !ok || task.Status != "running" {
		return
	}
	name := strings.TrimSpace(workerName)
	if name == "" {
		name = "对方"
	}
	result, err := json.Marshal(map[string]string{
		"output": "已交给 " + name + "。这次到此结束，后续由对方完成。",
	})
	if err != nil {
		return
	}
	if _, err := h.TaskService.CompleteTask(r.Context(), task.ID, result, textValue(task.SessionID), textValue(task.WorkDir), textValue(task.BranchName), false, "", textValue(task.DurableWorkDir)); err != nil {
		slog.Warn("mika handoff did not end the originating task", append(logger.RequestAttrs(r), "error", err, "task_id", uuidToString(task.ID))...)
	}
}

func textValue(v pgtype.Text) string {
	if !v.Valid {
		return ""
	}
	return v.String
}

func (h *Handler) mikaTaskMembers(w http.ResponseWriter, r *http.Request, member db.Member, userID string, req mikaStartRequest) ([]service.IssueMemberRef, string, bool) {
	creator := service.IssueMemberRef{Type: "member", ID: parseUUID(userID)}
	refs := []service.IssueMemberRef{creator}
	seen := map[string]struct{}{creator.Type + ":" + userID: {}}
	add := func(ref service.IssueMemberRef) {
		key := ref.Type + ":" + uuidToString(ref.ID)
		if _, dup := seen[key]; dup {
			return
		}
		seen[key] = struct{}{}
		refs = append(refs, ref)
	}
	if r.Header.Get("X-Actor-Source") == "task_token" {
		if agentID := r.Header.Get("X-Agent-ID"); agentID != "" {
			add(service.IssueMemberRef{Type: "agent", ID: parseUUID(agentID)})
		}
	}
	mentionName := ""
	if req.MentionAgentID != "" {
		req.Members = append(req.Members, groupChatMemberRef{MemberType: "agent", MemberID: req.MentionAgentID})
	}
	for _, raw := range req.Members {
		ref, ok := h.validateGroupChatMember(w, r, member, member.WorkspaceID, raw)
		if !ok {
			return nil, "", false
		}
		if raw.MemberType == "agent" && raw.MemberID == req.MentionAgentID {
			agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{ID: ref.ID, WorkspaceID: member.WorkspaceID})
			if err != nil {
				writeError(w, http.StatusBadRequest, "agent not found in this workspace")
				return nil, "", false
			}
			mentionName = agent.Name
		}
		add(ref)
	}
	return refs, mentionName, true
}

func (h *Handler) reuseMikaTaskChat(w http.ResponseWriter, r *http.Request, member db.Member, userID, chatID string, refs []service.IssueMemberRef) (db.Issue, []db.IssueMember, bool) {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", chatID)
	loadReq := r.Clone(r.Context())
	loadReq = loadReq.WithContext(context.WithValue(loadReq.Context(), chi.RouteCtxKey, rctx))
	issue, members, ok := h.loadGroupChat(w, loadReq)
	if !ok {
		return db.Issue{}, nil, false
	}
	if issue.IsDirectChat {
		writeError(w, http.StatusBadRequest, "a direct chat cannot be reused as a task group")
		return db.Issue{}, nil, false
	}
	if isReminder(issue) {
		writeError(w, http.StatusBadRequest, "a reminder cannot be reused as a task group")
		return db.Issue{}, nil, false
	}
	have := map[string]struct{}{}
	for _, existing := range members {
		have[existing.MemberType+":"+uuidToString(existing.MemberID)] = struct{}{}
	}
	for _, ref := range refs {
		key := ref.Type + ":" + uuidToString(ref.ID)
		if _, ok := have[key]; ok {
			continue
		}
		if ref.Type != "agent" {
			continue
		}
		if err := h.Queries.AddIssueMember(r.Context(), db.AddIssueMemberParams{
			IssueID:     issue.ID,
			WorkspaceID: issue.WorkspaceID,
			MemberType:  ref.Type,
			MemberID:    ref.ID,
			AddedByType: pgtype.Text{String: "member", Valid: true},
			AddedByID:   parseUUID(userID),
		}); err != nil && !isUniqueViolation(err) {
			slog.Warn("mika task chat add member failed", append(logger.RequestAttrs(r), "error", err)...)
			writeError(w, http.StatusInternalServerError, "failed to add member")
			return db.Issue{}, nil, false
		}
	}
	if !issue.IsTaskChat {
		if err := h.Queries.MarkIssueTaskChat(r.Context(), issue.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to mark task chat")
			return db.Issue{}, nil, false
		}
		issue.IsTaskChat = true
	}
	members, err := h.Queries.ListIssueMembers(r.Context(), db.ListIssueMembersParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load chat members")
		return db.Issue{}, nil, false
	}
	return issue, members, true
}

// postMemberChatMessage writes the instruction as the person, even when the
// caller is Mika's task token. A task-token comment would be authored by the
// agent, and an agent message in a group does not start anyone.
func (h *Handler) postMemberChatMessage(w http.ResponseWriter, r *http.Request, issueID, content string) (CommentResponse, bool) {
	raw, err := json.Marshal(CreateCommentRequest{Content: content})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to send message")
		return CommentResponse{}, false
	}
	ctx := r.Context()
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", issueID)
	commentReq := r.Clone(ctx)
	commentReq.Header = r.Header.Clone()
	commentReq.Header.Del("X-Actor-Source")
	commentReq.Header.Del("X-Agent-ID")
	commentReq.Header.Del("X-Task-ID")
	commentReq.Body = io.NopCloser(bytes.NewReader(raw))
	commentReq.ContentLength = int64(len(raw))
	commentReq.Method = http.MethodPost
	commentReq = commentReq.WithContext(context.WithValue(ctx, chi.RouteCtxKey, rctx))

	captured := &capturedResponse{header: make(http.Header)}
	h.CreateComment(captured, commentReq)
	if captured.code != http.StatusCreated {
		if captured.code == 0 {
			captured.code = http.StatusInternalServerError
		}
		for key, values := range captured.header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(captured.code)
		_, _ = w.Write(captured.body.Bytes())
		return CommentResponse{}, false
	}
	var message CommentResponse
	if err := json.Unmarshal(captured.body.Bytes(), &message); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to send message")
		return CommentResponse{}, false
	}
	return message, true
}

func (h *Handler) mikaAskCommentID(r *http.Request) string {
	if r.Header.Get("X-Actor-Source") != "task_token" {
		return ""
	}
	task, ok := h.taskFromRequestHeader(r)
	if !ok || !task.TriggerCommentID.Valid {
		return ""
	}
	return uuidToString(task.TriggerCommentID)
}

func (h *Handler) publishMikaTaskChat(workspaceID, userID string, issueID pgtype.UUID, askCommentID string) {
	payload := map[string]any{
		"issue_id":     uuidToString(issueID),
		"recipient_id": userID,
	}
	if askCommentID != "" {
		payload["ask_comment_id"] = askCommentID
	}
	h.publish(protocol.EventGroupChatUpdated, workspaceID, "member", userID, payload)
}

func mikaClip(s string, n int) string {
	if n <= 0 || utf8.RuneCountInString(s) <= n {
		return s
	}
	runes := []rune(s)
	return string(runes[:n])
}
