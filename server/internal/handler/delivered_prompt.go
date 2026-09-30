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
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// maxDeliveredPromptBytes is how much of a claim payload we keep. A group
// transcript can be long; past this the row keeps the start and says the
// rest was dropped.
const maxDeliveredPromptBytes = 256 << 10

type deliveredPromptResponse struct {
	Prompt    string `json:"prompt"`
	Truncated bool   `json:"truncated"`
}

// recordDispatchedTask stores the claim payload the server is about to hand
// to the daemon. Credentials and skill file bodies are left out. A failure
// here does not fail the claim: the daemon still receives the task.
func (h *Handler) recordDispatchedTask(ctx context.Context, taskID pgtype.UUID, resp AgentTaskResponse) {
	text, truncated := claimDispatchText(resp)
	if strings.TrimSpace(text) == "" {
		return
	}
	if err := h.Queries.InsertDeliveredPrompt(ctx, db.InsertDeliveredPromptParams{
		TaskID:    taskID,
		Prompt:    text,
		Truncated: truncated,
	}); err != nil {
		slog.Warn("dispatched task content was not stored", "task_id", uuidToString(taskID), "error", err)
	}
}

// claimDispatchText is the claim JSON with secrets and skill file bodies
// removed, pretty-printed so run details can show what the server sent.
func claimDispatchText(resp AgentTaskResponse) (string, bool) {
	resp.AuthToken = ""
	resp.RemoteMCPDaemonToken = ""
	if resp.Agent != nil {
		agent := *resp.Agent
		agent.CustomEnv = nil
		agent.McpConfig = nil
		agent.RuntimeConfig = maskClaimRuntimeConfig(agent.RuntimeConfig)
		agent.Skills = skillsWithoutBodies(agent.Skills)
		resp.Agent = &agent
	}
	raw, err := json.MarshalIndent(resp, "", "  ")
	if err != nil {
		return "", false
	}
	return clipDeliveredPrompt(util.SanitizeTextForPostgres(string(raw)))
}

func maskClaimRuntimeConfig(raw json.RawMessage) json.RawMessage {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil
	}
	maskGatewayToken(decoded)
	masked, err := json.Marshal(decoded)
	if err != nil {
		return nil
	}
	return masked
}

func skillsWithoutBodies(skills []service.AgentSkillData) []service.AgentSkillData {
	if len(skills) == 0 {
		return nil
	}
	out := make([]service.AgentSkillData, len(skills))
	for i, skill := range skills {
		out[i] = skill
		out[i].Content = ""
		if len(skill.Files) == 0 {
			continue
		}
		files := make([]service.AgentSkillFileData, len(skill.Files))
		for j, file := range skill.Files {
			files[j] = file
			files[j].Content = ""
		}
		out[i].Files = files
	}
	return out
}

// GetDeliveredPrompt returns the claim payload stored when this task was
// handed to a daemon, for a caller in the task's workspace. An empty prompt
// means this run has not been claimed yet.
func (h *Handler) GetDeliveredPrompt(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	taskUUID, ok := parseUUIDOrBadRequest(w, taskID, "task_id")
	if !ok {
		return
	}
	task, err := h.Queries.GetAgentTask(r.Context(), taskUUID)
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load task")
		return
	}
	wsID, err := h.TaskService.ResolveTaskWorkspaceIDChecked(r.Context(), task)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load task")
		return
	}
	if wsID == "" || wsID != middleware.WorkspaceIDFromContext(r.Context()) {
		writeError(w, http.StatusNotFound, "task not found")
		return
	}
	row, err := h.Queries.GetDeliveredPrompt(r.Context(), task.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusOK, deliveredPromptResponse{})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load prompt")
		return
	}
	writeJSON(w, http.StatusOK, deliveredPromptResponse{Prompt: row.Prompt, Truncated: row.Truncated})
}

func clipDeliveredPrompt(prompt string) (string, bool) {
	if len(prompt) <= maxDeliveredPromptBytes {
		return prompt, false
	}
	cut := maxDeliveredPromptBytes
	for cut > 0 && !utf8.RuneStart(prompt[cut]) {
		cut--
	}
	return prompt[:cut], true
}
