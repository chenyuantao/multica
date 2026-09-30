package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// maxUnusedRuntimeDeleteBatch bounds how many per-runtime transactions one
// cleanup request may open.
const maxUnusedRuntimeDeleteBatch = 200

// ListUnusedAgentRuntimes returns the runtimes the caller may delete that
// nothing depends on any more: offline, no active agent bound, no unfinished
// task, and not an instance of a live custom runtime profile. It is the
// preview for DeleteUnusedAgentRuntimes; retention GC reclaims the same rows on
// its own after the offline TTL.
func (h *Handler) ListUnusedAgentRuntimes(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}

	runtimes, err := h.Queries.ListUnusedAgentRuntimes(r.Context(), parseUUID(workspaceID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list unused runtimes")
		return
	}

	resp := make([]AgentRuntimeResponse, 0, len(runtimes))
	for _, rt := range runtimes {
		if !canEditRuntime(member, rt) {
			continue
		}
		resp = append(resp, runtimeToResponse(rt))
	}
	writeJSON(w, http.StatusOK, map[string]any{"runtimes": resp})
}

type deleteUnusedRuntimesRequest struct {
	RuntimeIDs []string `json:"runtime_ids"`
}

// DeleteUnusedAgentRuntimes deletes the runtimes the caller confirmed from the
// ListUnusedAgentRuntimes preview. Each runtime gets its own transaction and
// is re-checked under its row lock; one that gained an agent or a task since
// the preview, belongs to another workspace, or is not the caller's to delete
// is skipped rather than failing the batch. Unlike the single-runtime delete,
// nothing is cancelled or unbound from an active agent — only archived agents
// lose their binding, exactly as retention GC would do.
func (h *Handler) DeleteUnusedAgentRuntimes(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}

	var req deleteUnusedRuntimesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.RuntimeIDs) == 0 {
		writeError(w, http.StatusBadRequest, "runtime_ids is required")
		return
	}
	if len(req.RuntimeIDs) > maxUnusedRuntimeDeleteBatch {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("runtime_ids must contain at most %d ids", maxUnusedRuntimeDeleteBatch))
		return
	}
	ids := make([]pgtype.UUID, 0, len(req.RuntimeIDs))
	seen := make(map[string]struct{}, len(req.RuntimeIDs))
	for _, raw := range req.RuntimeIDs {
		id, err := util.ParseUUID(raw)
		if err != nil || !id.Valid {
			writeError(w, http.StatusBadRequest, "runtime_ids must be a list of valid UUIDs")
			return
		}
		key := uuidToString(id)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		ids = append(ids, id)
	}

	userID := uuidToString(member.UserID)
	deletedIDs := make([]string, 0, len(ids))
	skippedIDs := make([]string, 0)
	for _, id := range ids {
		teardown, deleted, err := h.deleteUnusedRuntime(r.Context(), member, workspaceID, id)
		if err != nil {
			slog.Warn("unused runtime cleanup: delete failed",
				"runtime_id", uuidToString(id), "workspace_id", workspaceID, "error", err)
		}
		if !deleted {
			skippedIDs = append(skippedIDs, uuidToString(id))
			continue
		}
		deletedIDs = append(deletedIDs, uuidToString(id))
		h.NotifyRuntimeGone(uuidToString(id))
		h.PublishRuntimeTeardown(r.Context(), teardown, workspaceID, "member", userID, "delete", false)
	}
	if len(deletedIDs) > 0 {
		h.PublishRuntimeRefresh(workspaceID, "member", userID, "delete")
	}

	slog.Info("unused runtimes deleted",
		"workspace_id", workspaceID,
		"deleted_by", userID,
		"deleted", len(deletedIDs),
		"skipped", len(skippedIDs))

	writeJSON(w, http.StatusOK, map[string]any{
		"deleted_ids": deletedIDs,
		"skipped_ids": skippedIDs,
	})
}

// deleteUnusedRuntime deletes one runtime if it is still unused and the member
// may delete it. deleted=false with a nil error means the runtime was skipped
// because it no longer qualifies.
func (h *Handler) deleteUnusedRuntime(ctx context.Context, member db.Member, workspaceID string, runtimeID pgtype.UUID) (service.RuntimeTeardownResult, bool, error) {
	var none service.RuntimeTeardownResult

	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return none, false, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)

	rt, err := qtx.LockAgentRuntime(ctx, runtimeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return none, false, nil
	}
	if err != nil {
		return none, false, fmt.Errorf("lock runtime: %w", err)
	}
	if uuidToString(rt.WorkspaceID) != workspaceID || !canEditRuntime(member, rt) {
		return none, false, nil
	}
	if _, err := qtx.ListUserAgentsByRuntimeForUpdate(ctx, runtimeID); err != nil {
		return none, false, fmt.Errorf("lock runtime agents: %w", err)
	}
	unused, err := qtx.IsAgentRuntimeUnused(ctx, runtimeID)
	if err != nil {
		return none, false, fmt.Errorf("re-check runtime: %w", err)
	}
	if !unused {
		return none, false, nil
	}

	teardown, err := service.TeardownRuntime(ctx, qtx, runtimeID, service.RuntimeTeardownOptions{CancelNonTerminalTasks: false})
	if err != nil {
		if errors.Is(err, service.ErrRuntimeNotDrained) {
			return none, false, nil
		}
		return none, false, fmt.Errorf("teardown runtime: %w", err)
	}
	if err := qtx.DeleteAgentRuntime(ctx, runtimeID); err != nil {
		return none, false, fmt.Errorf("delete runtime: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return none, false, fmt.Errorf("commit transaction: %w", err)
	}
	return teardown, true, nil
}
