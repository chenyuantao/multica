package handler

import (
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"net/http"
	"strings"
)

func (h *Handler) GetIMindClipAgent(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	var id pgtype.UUID
	err := h.DB.QueryRow(r.Context(), `SELECT imind_clip_agent_id FROM workspace WHERE id=$1`, member.WorkspaceID).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load clipping agent")
		return
	}
	var value any
	if id.Valid {
		value = uuidToString(id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"agent_id": value})
}

func (h *Handler) PutIMindClipAgent(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "workspace admin access required")
		return
	}
	var req struct {
		AgentID *string `json:"agent_id"`
	}
	if !decodeIMindBody(w, r, &req) {
		return
	}
	var id pgtype.UUID
	if req.AgentID != nil && *req.AgentID != "" {
		parsed, valid := parseUUIDOrBadRequest(w, *req.AgentID, "agent_id")
		if !valid {
			return
		}
		agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{ID: parsed, WorkspaceID: member.WorkspaceID})
		if err != nil {
			writeError(w, http.StatusBadRequest, "agent not found in this workspace")
			return
		}
		if !h.memberCanWireAgent(r.Context(), member, agent, uuidToString(member.WorkspaceID)) {
			writeError(w, http.StatusForbidden, "you can only configure an agent you have access to")
			return
		}
		id = parsed
	}
	if _, err := h.DB.Exec(r.Context(), `UPDATE workspace SET imind_clip_agent_id=$2 WHERE id=$1`, member.WorkspaceID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save clipping agent")
		return
	}
	var value any
	if id.Valid {
		value = uuidToString(id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"agent_id": value})
}

func (h *Handler) GetIMindDeepSeek(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, 404, "workspace not found")
		return
	}
	var configured bool
	if h.DB.QueryRow(r.Context(), `SELECT COALESCE(octet_length(imind_deepseek_key)>0,false) FROM workspace WHERE id=$1`, member.WorkspaceID).Scan(&configured) != nil {
		writeError(w, 500, "failed to load naming configuration")
		return
	}
	writeJSON(w, 200, map[string]bool{"configured": configured})
}
func (h *Handler) PutIMindDeepSeek(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, 404, "workspace not found")
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, 403, "workspace admin access required")
		return
	}
	var req struct {
		APIKey *string `json:"api_key"`
	}
	if !decodeIMindBody(w, r, &req) {
		return
	}
	if req.APIKey == nil {
		writeError(w, 400, "api_key is required")
		return
	}
	key := strings.TrimSpace(*req.APIKey)
	if len(key) > 512 || strings.ContainsAny(key, "\r\n\t ") {
		writeError(w, 400, "invalid api_key")
		return
	}
	var sealed []byte
	if key != "" {
		if h.IMindSecretBox == nil {
			writeErrorCode(w, 503, "imind_secret_unconfigured", "服务端尚未配置 MULTICA_IMIND_SECRET_KEY，请联系管理员")
			return
		}
		var err error
		sealed, err = h.IMindSecretBox.Seal([]byte(key))
		if err != nil {
			writeError(w, 500, "failed to protect API key")
			return
		}
	}
	if _, err := h.DB.Exec(r.Context(), `UPDATE workspace SET imind_deepseek_key=$2 WHERE id=$1`, member.WorkspaceID, sealed); err != nil {
		writeError(w, 500, "failed to save naming configuration")
		return
	}
	writeJSON(w, 200, map[string]bool{"configured": key != ""})
}
