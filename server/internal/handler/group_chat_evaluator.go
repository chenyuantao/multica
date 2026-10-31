package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/pkg/typesafe"
)

// groupChatEvaluator binds failover credentials to the current workspace.
// Loading and decrypting the key is deferred until the primary fails.
func (h *Handler) groupChatEvaluator(workspaceID pgtype.UUID) groupchat.Evaluator {
	if h.DB == nil || h.IMindSecretBox == nil || !workspaceID.Valid {
		return h.GroupChatDecider
	}
	return &workspaceChatEvaluator{
		primary: h.GroupChatDecider, client: h.IMindNamingHTTP, workspaceID: uuidToString(workspaceID),
		key: func(ctx context.Context) (string, error) {
			var sealed []byte
			if err := h.DB.QueryRow(ctx, `SELECT imind_deepseek_key FROM workspace WHERE id=$1`, workspaceID).Scan(&sealed); err != nil {
				return "", errors.New("decision fallback: cannot load workspace key")
			}
			if len(sealed) == 0 {
				return "", typesafe.ErrNotConfigured
			}
			key, err := h.IMindSecretBox.Open(sealed)
			if err != nil {
				return "", errors.New("decision fallback: cannot decrypt workspace key")
			}
			return string(key), nil
		},
	}
}

type workspaceChatEvaluator struct {
	primary     groupchat.Evaluator
	key         func(context.Context) (string, error)
	client      *http.Client
	workspaceID string
}

func (e *workspaceChatEvaluator) Enabled() bool {
	return (e.primary != nil && e.primary.Enabled()) || e.key != nil
}

func (e *workspaceChatEvaluator) Evaluate(ctx context.Context, state any, questions map[string]any) (map[string]typesafe.Answer, error) {
	primaryErr := typesafe.ErrNotConfigured
	if e.primary != nil && e.primary.Enabled() {
		answers, err := e.primary.Evaluate(ctx, state, questions)
		if err == nil {
			err = groupchat.ValidateChoiceAnswers(questions, answers)
		}
		if err == nil {
			slog.Debug("Jev decision succeeded", "workspace_id", e.workspaceID)
			return answers, nil
		}
		primaryErr = err
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if e.key == nil {
		return nil, primaryErr
	}
	key, err := e.key(ctx)
	if err != nil {
		return nil, errors.Join(primaryErr, err)
	}
	fallback := &groupchat.DeepSeekEvaluator{APIKey: key, HTTPClient: e.client}
	if !fallback.Enabled() {
		return nil, errors.Join(primaryErr, typesafe.ErrNotConfigured)
	}
	slog.Warn("Jev decision failed; trying DeepSeek", "workspace_id", e.workspaceID, "error", primaryErr)
	answers, err := fallback.Evaluate(ctx, state, questions)
	if err != nil {
		slog.Warn("DeepSeek decision fallback failed", "workspace_id", e.workspaceID, "error", err)
		return nil, errors.Join(primaryErr, err)
	}
	slog.Info("DeepSeek decision fallback succeeded", "workspace_id", e.workspaceID)
	return answers, nil
}
