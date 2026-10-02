package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/speech"
)

// SpeechRealtime proxies one press-to-talk utterance to DashScope.
// Mobile WebSocket cannot set Authorization, so the first text frame carries
// the session token. The DashScope key stays on the server.
//
// Origin is not a credential here: the socket does not accept the session
// cookie, only the token in that first frame.
func (h *Handler) SpeechRealtime(w http.ResponseWriter, r *http.Request) {
	cfg := speech.ConfigFromEnv()
	if cfg.APIKey == "" {
		writeErrorCode(w, http.StatusServiceUnavailable, "speech_unconfigured", "speech recognition is not configured")
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(256 * 1024)

	ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
	defer cancel()
	context.AfterFunc(ctx, func() { conn.Close() })

	_ = conn.SetReadDeadline(time.Now().Add(8 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Time{})

	var start struct {
		Type     string `json:"type"`
		Token    string `json:"token"`
		Language string `json:"language"`
		Corpus   string `json:"corpus"`
	}
	if err := json.Unmarshal(data, &start); err != nil || start.Type != "start" {
		_ = writeSpeech(conn, speech.ServerMessage{Type: "error", Message: "expected start"})
		return
	}
	userID, err := speechUserID(start.Token)
	if err != nil {
		_ = writeSpeech(conn, speech.ServerMessage{Type: "error", Message: "unauthorized"})
		return
	}

	upstream, err := speech.Dial(ctx, cfg)
	if err != nil {
		slog.Warn("speech: dial failed", "user_id", userID, "error", err)
		_ = writeSpeech(conn, speech.ServerMessage{Type: "error", Message: "speech recognition is unavailable"})
		return
	}
	slog.Info("speech: session started", "user_id", userID)

	client := &speechWS{conn: conn}
	if err := speech.Relay(ctx, client, upstream, speech.Options{
		Language: start.Language,
		Corpus:   start.Corpus,
	}); err != nil && ctx.Err() == nil {
		slog.Warn("speech: session ended", "user_id", userID, "error", err)
	}
}

func speechUserID(token string) (string, error) {
	claims, err := auth.ParseSessionToken(strings.TrimSpace(token))
	if err != nil {
		return "", err
	}
	sub, _ := claims["sub"].(string)
	sub = strings.TrimSpace(sub)
	if sub == "" {
		return "", auth.ErrNotSessionToken
	}
	email, _ := claims["email"].(string)
	if auth.IsTemporarilyDisabledUser(sub, email) {
		return "", auth.ErrNotSessionToken
	}
	return sub, nil
}

type speechWS struct {
	conn *websocket.Conn
}

func (c *speechWS) Read() (speech.ClientMessage, error) {
	kind, data, err := c.conn.ReadMessage()
	if err != nil {
		return speech.ClientMessage{}, err
	}
	if kind == websocket.BinaryMessage {
		return speech.ClientMessage{Kind: "audio", Audio: data}, nil
	}
	var msg struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		return speech.ClientMessage{}, err
	}
	switch msg.Type {
	case "commit":
		return speech.ClientMessage{Kind: "commit"}, nil
	case "cancel":
		return speech.ClientMessage{Kind: "cancel"}, nil
	default:
		return speech.ClientMessage{}, errUnexpectedSpeechFrame
	}
}

func (c *speechWS) Write(msg speech.ServerMessage) error {
	_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return writeSpeech(c.conn, msg)
}

func writeSpeech(conn *websocket.Conn, msg speech.ServerMessage) error {
	return conn.WriteJSON(msg)
}

var errUnexpectedSpeechFrame = errSpeechFrame("unexpected speech frame")

type errSpeechFrame string

func (e errSpeechFrame) Error() string { return string(e) }
