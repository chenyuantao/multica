// Package imindasr proxies microphone audio to Qwen-Audio-3.1-ASR-Flash-Message.
// The phone speaks a small JSON/PCM protocol. This package speaks DashScope's
// run-task protocol and keeps the API key on the server.
package imindasr

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const modelName = "qwen-audio-3.1-asr-flash-message"

// Config is the server-side DashScope target.
type Config struct {
	APIKey      string
	WorkspaceID string
	URL         string
}

// ConfigFromEnv reads DASHSCOPE_API_KEY and either DASHSCOPE_ASR_MESSAGE_URL
// or DASHSCOPE_WORKSPACE_ID. The key is never returned to the phone.
func ConfigFromEnv() (Config, bool) {
	cfg := Config{
		APIKey:      strings.TrimSpace(os.Getenv("DASHSCOPE_API_KEY")),
		WorkspaceID: strings.TrimSpace(os.Getenv("DASHSCOPE_WORKSPACE_ID")),
		URL:         strings.TrimSpace(os.Getenv("DASHSCOPE_ASR_MESSAGE_URL")),
	}
	if cfg.APIKey == "" {
		return cfg, false
	}
	if cfg.URL == "" && cfg.WorkspaceID != "" {
		cfg.URL = "wss://" + cfg.WorkspaceID + ".cn-beijing.maas.aliyuncs.com/api-ws/v1/inference"
	}
	return cfg, cfg.URL != ""
}

// Dial opens the model socket. Authorization is attached only on this hop.
func Dial(cfg Config) (*websocket.Conn, error) {
	header := http.Header{}
	header.Set("Authorization", "Bearer "+cfg.APIKey)
	conn, _, err := websocket.DefaultDialer.Dial(cfg.URL, header)
	return conn, err
}

// ClientMessage is one frame from the phone after the authenticated start.
type ClientMessage struct {
	Kind  string
	Audio []byte
}

// ServerMessage is JSON written back to the phone.
type ServerMessage struct {
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	StartMS    *int   `json:"start_ms,omitempty"`
	EndMS      *int   `json:"end_ms,omitempty"`
	SentenceID *int   `json:"sentence_id,omitempty"`
	Message    string `json:"message,omitempty"`
}

// Client is the phone socket.
type Client interface {
	Read() (ClientMessage, error)
	Write(ServerMessage) error
}

// Upstream is the DashScope socket.
type Upstream interface {
	WriteJSON(any) error
	WriteMessage(int, []byte) error
	ReadJSON(any) error
	Close() error
}

type envelope struct {
	Header struct {
		Event        string `json:"event"`
		ErrorMessage string `json:"error_message"`
	} `json:"header"`
	Payload struct {
		Output struct {
			Sentence struct {
				SentenceID  int    `json:"sentence_id"`
				BeginTime   *int   `json:"begin_time"`
				EndTime     *int   `json:"end_time"`
				Text        string `json:"text"`
				SentenceEnd bool   `json:"sentence_end"`
			} `json:"sentence"`
		} `json:"output"`
	} `json:"payload"`
}

// Relay runs one recognition session.
func Relay(ctx context.Context, client Client, up Upstream) error {
	defer up.Close()
	taskID := strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := up.WriteJSON(runTask(taskID)); err != nil {
		return err
	}
	if err := waitStarted(ctx, up); err != nil {
		return err
	}
	if err := client.Write(ServerMessage{Type: "ready"}); err != nil {
		return err
	}

	events := make(chan envelope, 8)
	readErr := make(chan error, 1)
	go func() {
		for {
			var ev envelope
			if err := up.ReadJSON(&ev); err != nil {
				readErr <- err
				return
			}
			events <- ev
		}
	}()
	incoming := make(chan ClientMessage, 8)
	clientErr := make(chan error, 1)
	go func() {
		for {
			msg, err := client.Read()
			if err != nil {
				clientErr <- err
				return
			}
			incoming <- msg
		}
	}()

	stopped := false
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-readErr:
			return err
		case err := <-clientErr:
			return err
		case ev := <-events:
			switch ev.Header.Event {
			case "result-generated":
				sentence := ev.Payload.Output.Sentence
				kind := "partial"
				if sentence.SentenceEnd {
					kind = "final"
				}
				id := sentence.SentenceID
				if err := client.Write(ServerMessage{
					Type: kind, Text: sentence.Text, StartMS: sentence.BeginTime, EndMS: sentence.EndTime, SentenceID: &id,
				}); err != nil {
					return err
				}
			case "task-finished":
				return client.Write(ServerMessage{Type: "done"})
			case "task-failed":
				msg := ev.Header.ErrorMessage
				if msg == "" {
					msg = "speech recognition failed"
				}
				_ = client.Write(ServerMessage{Type: "error", Message: msg})
				return fmt.Errorf("%s", msg)
			}
		case msg := <-incoming:
			switch msg.Kind {
			case "audio":
				if stopped || len(msg.Audio) == 0 {
					continue
				}
				if err := up.WriteMessage(websocket.BinaryMessage, msg.Audio); err != nil {
					return err
				}
			case "stop", "commit":
				if stopped {
					continue
				}
				stopped = true
				if err := up.WriteJSON(finishTask(taskID)); err != nil {
					return err
				}
			}
		}
	}
}

func waitStarted(ctx context.Context, up Upstream) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var ev envelope
		if err := up.ReadJSON(&ev); err != nil {
			return err
		}
		switch ev.Header.Event {
		case "task-started":
			return nil
		case "task-failed":
			if ev.Header.ErrorMessage != "" {
				return fmt.Errorf("%s", ev.Header.ErrorMessage)
			}
			return fmt.Errorf("speech task was rejected")
		}
	}
}

func runTask(taskID string) map[string]any {
	return map[string]any{
		"header": map[string]string{"action": "run-task", "task_id": taskID, "streaming": "duplex"},
		"payload": map[string]any{
			"task_group": "audio",
			"task":       "asr",
			"function":   "recognition",
			"model":      modelName,
			"parameters": map[string]any{
				"sample_rate":                 16000,
				"format":                      "pcm",
				"intermediate_result_enabled": true,
				"vad_model":                   "near_meeting_16k",
			},
			"input": map[string]any{},
		},
	}
}

func finishTask(taskID string) map[string]any {
	return map[string]any{
		"header":  map[string]string{"action": "finish-task", "task_id": taskID, "streaming": "duplex"},
		"payload": map[string]any{"input": map[string]any{}},
	}
}

// RunTaskJSON exposes the upstream start command for tests.
func RunTaskJSON(taskID string) ([]byte, error) { return json.Marshal(runTask(taskID)) }
