package speech

import (
	"context"
	"encoding/json"
	"io"
	"testing"
	"time"
)

type pipeUpstream struct {
	writes chan []byte
	reads  chan []byte
}

func (p *pipeUpstream) WriteJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	p.writes <- b
	return nil
}

func (p *pipeUpstream) ReadJSON(v any) error {
	b, ok := <-p.reads
	if !ok {
		return io.EOF
	}
	return json.Unmarshal(b, v)
}

func (p *pipeUpstream) Close() error { return nil }

type scriptClient struct {
	in  chan ClientMessage
	out chan ServerMessage
}

func (c *scriptClient) Read() (ClientMessage, error) {
	msg, ok := <-c.in
	if !ok {
		return ClientMessage{}, io.EOF
	}
	return msg, nil
}

func (c *scriptClient) Write(msg ServerMessage) error {
	c.out <- msg
	return nil
}

func recvJSON(t *testing.T, ch <-chan []byte) map[string]any {
	t.Helper()
	select {
	case b := <-ch:
		var out map[string]any
		if err := json.Unmarshal(b, &out); err != nil {
			t.Fatalf("unmarshal upstream write: %v", err)
		}
		return out
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for upstream write")
	}
	return nil
}

func recvMsg(t *testing.T, ch <-chan ServerMessage) ServerMessage {
	t.Helper()
	select {
	case msg := <-ch:
		return msg
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for client message")
	}
	return ServerMessage{}
}

func TestRelayManualUtteranceStreamsThenCommits(t *testing.T) {
	up := &pipeUpstream{writes: make(chan []byte, 8), reads: make(chan []byte, 8)}
	client := &scriptClient{in: make(chan ClientMessage, 4), out: make(chan ServerMessage, 8)}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() {
		errCh <- Relay(ctx, client, up, Options{Language: "zh", Corpus: "Multica CODOC-8"})
	}()

	update := recvJSON(t, up.writes)
	if update["type"] != "session.update" {
		t.Fatalf("type = %v", update["type"])
	}
	session, _ := update["session"].(map[string]any)
	if session["turn_detection"] != nil {
		t.Fatalf("turn_detection = %#v, want null for manual mode", session["turn_detection"])
	}
	transcription, _ := session["input_audio_transcription"].(map[string]any)
	if transcription["language"] != "zh" {
		t.Fatalf("language = %#v", transcription["language"])
	}
	corpus, _ := transcription["corpus"].(map[string]any)
	if corpus["text"] != "Multica CODOC-8" {
		t.Fatalf("corpus = %#v", corpus["text"])
	}

	up.reads <- []byte(`{"type":"session.created"}`)
	up.reads <- []byte(`{"type":"session.updated"}`)
	if ready := recvMsg(t, client.out); ready.Type != "ready" {
		t.Fatalf("ready = %#v", ready)
	}

	client.in <- ClientMessage{Kind: "audio", Audio: []byte{1, 2, 3, 4}}
	appendEv := recvJSON(t, up.writes)
	if appendEv["type"] != "input_audio_buffer.append" || appendEv["audio"] == "" {
		t.Fatalf("append = %#v", appendEv)
	}

	up.reads <- []byte(`{"type":"conversation.item.input_audio_transcription.text","text":"你好","stash":"世界"}`)
	partial := recvMsg(t, client.out)
	if partial.Type != "partial" || partial.Text != "你好世界" {
		t.Fatalf("partial = %#v", partial)
	}

	client.in <- ClientMessage{Kind: "commit"}
	if commit := recvJSON(t, up.writes); commit["type"] != "input_audio_buffer.commit" {
		t.Fatalf("commit = %#v", commit)
	}
	if finish := recvJSON(t, up.writes); finish["type"] != "session.finish" {
		t.Fatalf("finish = %#v", finish)
	}
	up.reads <- []byte(`{"type":"conversation.item.input_audio_transcription.completed","transcript":"你好，世界"}`)
	final := recvMsg(t, client.out)
	if final.Type != "final" || final.Text != "你好，世界" {
		t.Fatalf("final = %#v", final)
	}
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}
}

func TestRelayCancelDoesNotCommit(t *testing.T) {
	up := &pipeUpstream{writes: make(chan []byte, 4), reads: make(chan []byte, 4)}
	client := &scriptClient{in: make(chan ClientMessage, 2), out: make(chan ServerMessage, 4)}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- Relay(ctx, client, up, Options{})
	}()

	_ = recvJSON(t, up.writes)
	up.reads <- []byte(`{"type":"session.updated"}`)
	_ = recvMsg(t, client.out)
	client.in <- ClientMessage{Kind: "cancel"}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	select {
	case extra := <-up.writes:
		t.Fatalf("unexpected upstream write after cancel: %s", extra)
	default:
	}
}
