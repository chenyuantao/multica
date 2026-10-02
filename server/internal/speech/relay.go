package speech

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
)

// Manual mode (turn_detection null) matches press-to-talk: the client commits
// the buffer when the finger lifts, instead of letting server VAD cut the
// utterance on a pause.
const maxCorpusRunes = 8000

var eventSeq atomic.Int64

func eventID() string {
	return fmt.Sprintf("evt_%d", eventSeq.Add(1))
}

// Options are the recognition hints for one press-to-talk utterance.
type Options struct {
	Language string
	Corpus   string
}

// ClientMessage is one frame from the phone. Audio is raw PCM16 mono.
type ClientMessage struct {
	Kind  string
	Audio []byte
}

// ServerMessage is JSON written back to the phone.
type ServerMessage struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
}

// Upstream is the DashScope realtime socket.
type Upstream interface {
	WriteJSON(v any) error
	ReadJSON(v any) error
	Close() error
}

// Client is the phone socket, already past its authenticated start frame.
type Client interface {
	Read() (ClientMessage, error)
	Write(ServerMessage) error
}

type asrEvent struct {
	Type       string `json:"type"`
	Text       string `json:"text"`
	Stash      string `json:"stash"`
	Transcript string `json:"transcript"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Relay opens one manual-mode utterance. It forwards PCM as
// input_audio_buffer.append, streams text+stash previews, and on commit
// finishes the DashScope session and returns the completed transcript.
func Relay(ctx context.Context, client Client, up Upstream, opts Options) error {
	defer up.Close()
	if err := up.WriteJSON(sessionUpdate(opts)); err != nil {
		return err
	}
	if err := waitReady(ctx, up); err != nil {
		return err
	}
	if err := client.Write(ServerMessage{Type: "ready"}); err != nil {
		return err
	}

	events := make(chan asrEvent, 8)
	readErr := make(chan error, 1)
	go func() {
		for {
			var ev asrEvent
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

	var preview string
	committed := false
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-readErr:
			if committed {
				return client.Write(ServerMessage{Type: "final", Text: preview})
			}
			return err
		case err := <-clientErr:
			return err
		case ev := <-events:
			switch ev.Type {
			case "conversation.item.input_audio_transcription.text":
				next := ev.Text + ev.Stash
				if next == "" || next == preview {
					continue
				}
				preview = next
				if err := client.Write(ServerMessage{Type: "partial", Text: next}); err != nil {
					return err
				}
			case "conversation.item.input_audio_transcription.completed":
				if ev.Transcript != "" {
					preview = ev.Transcript
				}
				if committed {
					return client.Write(ServerMessage{Type: "final", Text: preview})
				}
			case "session.finished":
				if committed {
					return client.Write(ServerMessage{Type: "final", Text: preview})
				}
			case "error", "conversation.item.input_audio_transcription.failed":
				if committed {
					return client.Write(ServerMessage{Type: "final", Text: preview})
				}
				msg := "speech recognition failed"
				if ev.Error != nil && ev.Error.Message != "" {
					msg = ev.Error.Message
				}
				_ = client.Write(ServerMessage{Type: "error", Message: msg})
				return fmt.Errorf("%s", msg)
			}
		case msg := <-incoming:
			switch msg.Kind {
			case "audio":
				if committed || len(msg.Audio) == 0 {
					continue
				}
				if err := up.WriteJSON(appendAudio(msg.Audio)); err != nil {
					return err
				}
			case "cancel":
				return nil
			case "commit":
				committed = true
				if err := up.WriteJSON(map[string]any{
					"event_id": eventID(),
					"type":     "input_audio_buffer.commit",
				}); err != nil {
					return err
				}
				if err := up.WriteJSON(map[string]any{
					"event_id": eventID(),
					"type":     "session.finish",
				}); err != nil {
					return err
				}
			}
		}
	}
}

func waitReady(ctx context.Context, up Upstream) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var ev asrEvent
		if err := up.ReadJSON(&ev); err != nil {
			return err
		}
		switch ev.Type {
		case "session.updated":
			return nil
		case "error":
			msg := "speech session was rejected"
			if ev.Error != nil && ev.Error.Message != "" {
				msg = ev.Error.Message
			}
			return fmt.Errorf("%s", msg)
		}
	}
}

func sessionUpdate(opts Options) map[string]any {
	transcription := map[string]any{"language": normalizeLanguage(opts.Language)}
	if corpus := trimCorpus(opts.Corpus); corpus != "" {
		transcription["corpus"] = map[string]string{"text": corpus}
	}
	return map[string]any{
		"event_id": eventID(),
		"type":     "session.update",
		"session": map[string]any{
			"modalities":                []string{"text"},
			"input_audio_format":        "pcm",
			"sample_rate":               16000,
			"input_audio_transcription": transcription,
			"turn_detection":            nil,
		},
	}
}

func appendAudio(pcm []byte) map[string]any {
	return map[string]any{
		"event_id": eventID(),
		"type":     "input_audio_buffer.append",
		"audio":    base64.StdEncoding.EncodeToString(pcm),
	}
}

func normalizeLanguage(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "zh", "yue", "en", "ja", "de", "ko", "ru", "fr", "pt", "ar", "it", "es", "hi", "id", "th", "tr", "uk", "vi":
		return strings.ToLower(strings.TrimSpace(language))
	default:
		return "zh"
	}
}

func trimCorpus(corpus string) string {
	corpus = strings.TrimSpace(corpus)
	runes := []rune(corpus)
	if len(runes) > maxCorpusRunes {
		return string(runes[len(runes)-maxCorpusRunes:])
	}
	return corpus
}

// SessionUpdateJSON is the DashScope session.update body. Tests assert manual mode.
func SessionUpdateJSON(opts Options) ([]byte, error) {
	return json.Marshal(sessionUpdate(opts))
}
