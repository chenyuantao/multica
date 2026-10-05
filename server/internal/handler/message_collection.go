package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// A saved message is stored as text, same ceiling as a chat comment.
const (
	collectionMaxBytes     = 64 * 1024
	collectionLabelMaxRune = 200
)

type MessageCollectionResponse struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	Content     string `json:"content"`
	SourceTitle string `json:"source_title"`
	SenderName  string `json:"sender_name"`
	CreatedAt   string `json:"created_at"`
}

type CreateMessageCollectionRequest struct {
	Content     string `json:"content"`
	SourceTitle string `json:"source_title"`
	SenderName  string `json:"sender_name"`
}

func messageCollectionResponse(row db.MessageCollection) MessageCollectionResponse {
	created := ""
	if row.CreatedAt.Valid {
		created = row.CreatedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return MessageCollectionResponse{
		ID:          uuidToString(row.ID),
		WorkspaceID: uuidToString(row.WorkspaceID),
		Content:     row.Content,
		SourceTitle: row.SourceTitle,
		SenderName:  row.SenderName,
		CreatedAt:   created,
	}
}

func clipCollectionLabel(value string) string {
	value = strings.TrimSpace(sanitizeNullBytes(value))
	runes := []rune(value)
	if len(runes) > collectionLabelMaxRune {
		return string(runes[:collectionLabelMaxRune])
	}
	return value
}

func (h *Handler) ListMessageCollections(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return
	}
	rows, err := h.Queries.ListMessageCollections(r.Context(), db.ListMessageCollectionsParams{
		WorkspaceID: wsID,
		UserID:      parseUUID(userID),
	})
	if err != nil {
		slog.Warn("list message collections failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to list collections")
		return
	}
	out := make([]MessageCollectionResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, messageCollectionResponse(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"collections": out})
}

func (h *Handler) CreateMessageCollection(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return
	}
	var req CreateMessageCollectionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, collectionMaxBytes+4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	content := sanitizeNullBytes(req.Content)
	if strings.TrimSpace(content) == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if len(content) > collectionMaxBytes {
		writeError(w, http.StatusBadRequest, "content is too long")
		return
	}
	sourceTitle := clipCollectionLabel(req.SourceTitle)
	senderName := clipCollectionLabel(req.SenderName)
	if sourceTitle == "" || senderName == "" {
		writeError(w, http.StatusBadRequest, "source_title and sender_name are required")
		return
	}
	row, err := h.Queries.CreateMessageCollection(r.Context(), db.CreateMessageCollectionParams{
		WorkspaceID: wsID,
		UserID:      parseUUID(userID),
		Content:     content,
		SourceTitle: sourceTitle,
		SenderName:  senderName,
	})
	if err != nil {
		slog.Warn("create message collection failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to save collection")
		return
	}
	writeJSON(w, http.StatusCreated, messageCollectionResponse(row))
}

func (h *Handler) DeleteMessageCollection(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "id")
	if !ok {
		return
	}
	n, err := h.Queries.DeleteMessageCollection(r.Context(), db.DeleteMessageCollectionParams{
		ID:          id,
		WorkspaceID: wsID,
		UserID:      parseUUID(userID),
	})
	if err != nil {
		slog.Warn("delete message collection failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to remove collection")
		return
	}
	if n == 0 {
		writeError(w, http.StatusNotFound, "collection not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
