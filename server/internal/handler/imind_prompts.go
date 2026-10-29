package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/imind"
)

type imindPromptResponse struct {
	Kind     string `json:"kind"`
	Default  string `json:"default_template"`
	Template string `json:"template"`
	Custom   bool   `json:"custom"`
}

func (h *Handler) loadIMindPrompts(ctx context.Context, workspaceID pgtype.UUID) (map[string]string, error) {
	var raw []byte
	if err := h.DB.QueryRow(ctx, `SELECT imind_prompt_templates FROM workspace WHERE id=$1`, workspaceID).Scan(&raw); err != nil {
		return nil, err
	}
	var overrides map[string]string
	if err := json.Unmarshal(raw, &overrides); err != nil {
		return nil, err
	}
	return overrides, nil
}

func (h *Handler) renderIMindPrompt(ctx context.Context, workspaceID pgtype.UUID, kind string, values map[string]string) (string, error) {
	overrides, err := h.loadIMindPrompts(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	template, custom := overrides[kind]
	if !custom {
		template = imind.DefaultPrompts[kind]
	}
	return imind.RenderPrompt(template, values)
}

func (h *Handler) GetIMindPrompts(w http.ResponseWriter, r *http.Request) {
	member, ok := ctxMember(r.Context())
	if !ok {
		writeError(w, 404, "workspace not found")
		return
	}
	overrides, err := h.loadIMindPrompts(r.Context(), member.WorkspaceID)
	if err != nil {
		writeError(w, 500, "failed to load prompt templates")
		return
	}
	prompts := make([]imindPromptResponse, 0, len(imind.PromptKinds))
	for _, kind := range imind.PromptKinds {
		template, custom := overrides[kind]
		if !custom {
			template = imind.DefaultPrompts[kind]
		}
		prompts = append(prompts, imindPromptResponse{Kind: kind, Default: imind.DefaultPrompts[kind], Template: template, Custom: custom})
	}
	writeJSON(w, 200, map[string]any{"prompts": prompts, "variables": imind.PromptVariables})
}

// A single-kind update avoids overwriting another administrator's other templates.
func (h *Handler) PutIMindPrompt(w http.ResponseWriter, r *http.Request) {
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
		Kind     string          `json:"kind"`
		Template json.RawMessage `json:"template"`
	}
	if !decodeIMindBody(w, r, &req) {
		return
	}
	if _, ok := imind.DefaultPrompts[req.Kind]; !ok {
		writeError(w, 400, "unknown prompt kind")
		return
	}
	if len(req.Template) == 0 {
		writeError(w, 400, "template is required; use null to restore the default")
		return
	}
	var template *string
	if err := json.Unmarshal(req.Template, &template); err != nil {
		writeError(w, 400, "template must be a string or null")
		return
	}
	var err error
	if template == nil {
		_, err = h.DB.Exec(r.Context(), `UPDATE workspace SET imind_prompt_templates=imind_prompt_templates-$2::text WHERE id=$1`, member.WorkspaceID, req.Kind)
	} else {
		if err := imind.ValidatePrompt(req.Kind, *template); err != nil {
			writeError(w, 400, err.Error())
			return
		}
		_, err = h.DB.Exec(r.Context(), `UPDATE workspace SET imind_prompt_templates=jsonb_set(imind_prompt_templates,ARRAY[$2::text],to_jsonb($3::text)) WHERE id=$1`, member.WorkspaceID, req.Kind, *template)
	}
	if err != nil {
		writeError(w, 500, "failed to save prompt template")
		return
	}
	h.GetIMindPrompts(w, r)
}
