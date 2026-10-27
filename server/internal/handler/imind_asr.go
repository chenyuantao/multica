package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/imindasr"
)

// IMindASR proxies one recording to qwen-audio-3.1-asr-flash-message.
// The phone cannot reliably set an Authorization header on its WebSocket, so
// the first text frame carries the Multica session token.
func (h *Handler) IMindASR(w http.ResponseWriter, r *http.Request) {
	cfg, ok := imindasr.ConfigFromEnv()
	if !ok {
		writeErrorCode(w, http.StatusServiceUnavailable, "imind_asr_unconfigured", "iMind speech recognition is not configured")
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(256 * 1024)
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Hour)
	defer cancel()

	_ = conn.SetReadDeadline(time.Now().Add(8 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	var start struct {
		Type  string `json:"type"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(data, &start); err != nil || start.Type != "start" {
		_ = conn.WriteJSON(imindasr.ServerMessage{Type: "error", Message: "expected start"})
		return
	}
	userID, err := speechUserID(start.Token)
	if err != nil {
		_ = conn.WriteJSON(imindasr.ServerMessage{Type: "error", Message: "unauthorized"})
		return
	}
	upstream, err := imindasr.Dial(cfg)
	if err != nil {
		slog.Warn("imind asr: dial failed", "user_id", userID, "error", err)
		_ = conn.WriteJSON(imindasr.ServerMessage{Type: "error", Message: "speech recognition is unavailable"})
		return
	}
	if err := imindasr.Relay(ctx, &imindASRClient{conn: conn}, upstream); err != nil && ctx.Err() == nil {
		slog.Warn("imind asr: session ended", "user_id", userID, "error", err)
	}
}

type imindASRClient struct{ conn *websocket.Conn }

func (c *imindASRClient) Read() (imindasr.ClientMessage, error) {
	kind, data, err := c.conn.ReadMessage()
	if err != nil {
		return imindasr.ClientMessage{}, err
	}
	if kind == websocket.BinaryMessage {
		return imindasr.ClientMessage{Kind: "audio", Audio: data}, nil
	}
	var msg struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		return imindasr.ClientMessage{}, err
	}
	return imindasr.ClientMessage{Kind: msg.Type}, nil
}

func (c *imindASRClient) Write(msg imindasr.ServerMessage) error {
	_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return c.conn.WriteJSON(msg)
}
