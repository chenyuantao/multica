package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/push"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	pushSubscriptionBodyLimit = 8 << 10
	maxPushTokenLength        = 2048
	maxPushKeyLength          = 256
	maxPushUserAgentLength    = 512
)

type pushConfigResponse struct {
	// Empty when this deployment has no VAPID key pair configured.
	WebPushPublicKey string `json:"web_push_public_key"`
}

func (h *Handler) GetPushConfig(w http.ResponseWriter, r *http.Request) {
	resp := pushConfigResponse{}
	if cfg := push.WebPushConfigFromEnv(); cfg.Enabled() {
		resp.WebPushPublicKey = cfg.PublicKey
	}
	writeJSON(w, http.StatusOK, resp)
}

type pushSubscriptionRequest struct {
	Platform string `json:"platform"`
	Token    string `json:"token"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func decodePushSubscriptionRequest(w http.ResponseWriter, r *http.Request) (pushSubscriptionRequest, bool) {
	var req pushSubscriptionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, pushSubscriptionBodyLimit)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return req, false
	}
	req.Platform = strings.TrimSpace(req.Platform)
	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" || len(req.Token) > maxPushTokenLength {
		writeError(w, http.StatusBadRequest, "invalid token")
		return req, false
	}
	return req, true
}

func (h *Handler) RegisterPushSubscription(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	req, ok := decodePushSubscriptionRequest(w, r)
	if !ok {
		return
	}
	switch req.Platform {
	case push.PlatformWebPush:
		if !push.WebPushConfigFromEnv().Enabled() {
			writeError(w, http.StatusBadRequest, "web push is not configured on this server")
			return
		}
		if err := push.ValidateWebPushEndpoint(req.Token); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Keys.P256dh == "" || req.Keys.Auth == "" ||
			len(req.Keys.P256dh) > maxPushKeyLength || len(req.Keys.Auth) > maxPushKeyLength {
			writeError(w, http.StatusBadRequest, "invalid subscription keys")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "unsupported platform")
		return
	}

	userAgent := r.UserAgent()
	if len(userAgent) > maxPushUserAgentLength {
		userAgent = userAgent[:maxPushUserAgentLength]
	}
	sub, err := h.Queries.UpsertPushSubscription(r.Context(), db.UpsertPushSubscriptionParams{
		UserID:    parseUUID(userID),
		Platform:  req.Platform,
		Token:     req.Token,
		P256dh:    req.Keys.P256dh,
		Auth:      req.Keys.Auth,
		UserAgent: userAgent,
	})
	if err != nil {
		slog.Warn("UpsertPushSubscription failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to register push subscription")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":       uuidToString(sub.ID),
		"platform": sub.Platform,
	})
}

func (h *Handler) DeletePushSubscription(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	req, ok := decodePushSubscriptionRequest(w, r)
	if !ok {
		return
	}
	if err := h.Queries.DeletePushSubscriptionForUser(r.Context(), db.DeletePushSubscriptionForUserParams{
		UserID:   parseUUID(userID),
		Platform: req.Platform,
		Token:    req.Token,
	}); err != nil {
		slog.Warn("DeletePushSubscriptionForUser failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to delete push subscription")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
