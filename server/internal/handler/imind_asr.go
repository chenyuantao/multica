package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/imindasr"
)

// IMindASR forwards authenticated, workspace-authorized audio to the ASR model.
func (h *Handler) IMindASR(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.iMindPeer(w, r, r.URL.Query().Get("share_machine")); !ok {
		return
	}
	cfg, ok := imindasr.ConfigFromEnv()
	if !ok {
		writeErrorCode(w, http.StatusServiceUnavailable, "imind_asr_unconfigured", "iMind speech recognition is not configured")
		return
	}
	upgrader := websocket.Upgrader{}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(256 * 1024)
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Hour)
	defer cancel()

	_ = conn.SetReadDeadline(time.Now().Add(8 * time.Second))
	kind, data, err := conn.ReadMessage()
	if err != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	client := &imindASRClient{conn: conn}
	var start struct {
		Type         string `json:"type"`
		SampleRateHz int    `json:"sample_rate_hz"`
		Format       string `json:"format"`
		Language     string `json:"language"`
	}
	if kind != websocket.TextMessage || decodeIMindJSON(data, &start) != nil || start.Type != "start" ||
		start.SampleRateHz != 16000 || start.Format != "pcm_s16le" || (start.Language != "" && start.Language != "zh") {
		_ = client.Write(imindasr.ServerMessage{Type: "error", Code: "asr_invalid_start", Message: "expected start with 16000 Hz pcm_s16le audio"})
		return
	}
	userID := requestUserID(r)
	upstream, err := imindasr.Dial(ctx, cfg)
	if err != nil {
		slog.Warn("imind asr: dial failed", "user_id", userID)
		_ = client.Write(imindasr.ServerMessage{Type: "error", Code: "asr_unavailable", Message: "speech recognition is unavailable"})
		return
	}
	if err := imindasr.Relay(ctx, client, upstream); err != nil && ctx.Err() == nil {
		slog.Warn("imind asr: session ended", "user_id", userID)
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
	if kind != websocket.TextMessage || decodeIMindJSON(data, &msg) != nil || (msg.Type != "stop" && msg.Type != "commit") {
		return imindasr.ClientMessage{}, errors.New("invalid ASR control frame")
	}
	return imindasr.ClientMessage{Kind: msg.Type}, nil
}

func (c *imindASRClient) Close() error { return c.conn.Close() }

func (c *imindASRClient) Write(msg imindasr.ServerMessage) error {
	_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return c.conn.WriteJSON(msg)
}
