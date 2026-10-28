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
	"sync"
	"time"

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
func Dial(ctx context.Context, cfg Config) (*websocket.Conn, error) {
	header := http.Header{}
	header.Set("Authorization", "Bearer "+cfg.APIKey)
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, cfg.URL, header)
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
	Text       string `json:"text"`
	StartMS    *int   `json:"start_ms,omitempty"`
	EndMS      *int   `json:"end_ms,omitempty"`
	SentenceID *int   `json:"sentence_id,omitempty"`
	Message    string `json:"message,omitempty"`
	Code       string `json:"code,omitempty"`
}

// Client is the phone socket.
type Client interface {
	Read() (ClientMessage, error)
	Write(ServerMessage) error
	Close() error
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
func Relay(ctx context.Context, client Client, up Upstream) (err error) {
	ctx, cancel := context.WithCancel(ctx)
	var readers sync.WaitGroup
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		<-ctx.Done()
		_ = up.Close()
		_ = client.Close()
	}()
	defer func() {
		if err != nil && ctx.Err() == nil {
			_ = client.Write(ServerMessage{Type: "error", Code: "asr_unavailable", Message: "speech recognition session failed"})
		}
		cancel()
		<-watchDone
		readers.Wait()
	}()
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
	readers.Add(1)
	go func() {
		defer readers.Done()
		for {
			var ev envelope
			if err := up.ReadJSON(&ev); err != nil {
				readErr <- err
				return
			}
			select {
			case events <- ev:
			case <-ctx.Done():
				return
			}
			if ev.Header.Event == "task-finished" || ev.Header.Event == "task-failed" {
				return
			}
		}
	}()
	incoming := make(chan ClientMessage, 8)
	clientErr := make(chan error, 1)
	readers.Add(1)
	go func() {
		defer readers.Done()
		for {
			msg, err := client.Read()
			if err != nil {
				clientErr <- err
				return
			}
			select {
			case incoming <- msg:
			case <-ctx.Done():
				return
			}
			if msg.Kind == "stop" || msg.Kind == "commit" {
				return
			}
		}
	}()

	stopped := false
	var finishTimeout <-chan time.Time
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-finishTimeout:
			return fmt.Errorf("speech finish timed out")
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
				return fmt.Errorf("speech recognition failed")
			}
		case msg := <-incoming:
			switch msg.Kind {
			case "audio":
				if stopped || len(msg.Audio) == 0 {
					continue
				}
				if len(msg.Audio)%2 != 0 {
					return fmt.Errorf("invalid PCM frame")
				}
				if err := up.WriteMessage(websocket.BinaryMessage, msg.Audio); err != nil {
					return err
				}
			case "stop", "commit":
				if stopped {
					continue
				}
				stopped = true
				timer := time.NewTimer(15 * time.Second)
				defer timer.Stop()
				finishTimeout = timer.C
				if err := up.WriteJSON(finishTask(taskID)); err != nil {
					return err
				}
			}
		}
	}
}

func waitStarted(ctx context.Context, up Upstream) error {
	if socket, ok := up.(interface{ SetReadDeadline(time.Time) error }); ok {
		_ = socket.SetReadDeadline(time.Now().Add(10 * time.Second))
		defer socket.SetReadDeadline(time.Time{})
	}
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
