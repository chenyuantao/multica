package imindasr

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type memClient struct {
	in    []ClientMessage
	out   []ServerMessage
	block chan struct{}
	ready chan struct{}
}

func (c *memClient) Read() (ClientMessage, error) {
	if len(c.in) == 0 {
		<-c.block
		return ClientMessage{}, context.Canceled
	}
	msg := c.in[0]
	c.in = c.in[1:]
	return msg, nil
}

func (c *memClient) Close() error { close(c.block); return nil }

func (c *memClient) Write(msg ServerMessage) error {
	c.out = append(c.out, msg)
	if msg.Type == "ready" && c.ready != nil {
		close(c.ready)
	}
	return nil
}

type scriptUpstream struct {
	mu         sync.Mutex
	jsonWrites []map[string]any
	audio      [][]byte
	pending    []envelope
	wait       chan struct{}
	closed     chan struct{}
	startBlock chan struct{}
	rejection  string
	reads      int
}

func (u *scriptUpstream) WriteJSON(v any) error {
	raw, _ := json.Marshal(v)
	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	u.mu.Lock()
	u.jsonWrites = append(u.jsonWrites, decoded)
	if len(u.jsonWrites) == 2 {
		var done envelope
		done.Header.Event = "task-finished"
		u.pending = append(u.pending, done)
		close(u.wait)
	}
	u.mu.Unlock()
	return nil
}

func (u *scriptUpstream) WriteMessage(kind int, data []byte) error {
	if kind != websocket.BinaryMessage {
		return context.Canceled
	}
	begin, end := 170, 920
	u.mu.Lock()
	u.audio = append(u.audio, append([]byte(nil), data...))
	var ev envelope
	ev.Header.Event = "result-generated"
	ev.Payload.Output.Sentence.Text = "好，我们开始"
	ev.Payload.Output.Sentence.BeginTime = &begin
	ev.Payload.Output.Sentence.EndTime = &end
	ev.Payload.Output.Sentence.SentenceEnd = true
	u.pending = append(u.pending, ev)
	u.mu.Unlock()
	return nil
}

func (u *scriptUpstream) ReadJSON(v any) error {
	u.mu.Lock()
	u.reads++
	if u.reads == 1 {
		u.mu.Unlock()
		if u.startBlock != nil {
			close(u.startBlock)
			<-u.closed
			return context.Canceled
		}
		var started envelope
		started.Header.Event = "task-started"
		if u.rejection != "" {
			started.Header.Event = "task-failed"
			started.Header.ErrorMessage = u.rejection
		}
		raw, _ := json.Marshal(started)
		return json.Unmarshal(raw, v)
	}
	for len(u.pending) == 0 {
		u.mu.Unlock()
		select {
		case <-u.wait:
		case <-u.closed:
			return context.Canceled
		}
		u.mu.Lock()
	}
	ev := u.pending[0]
	u.pending = u.pending[1:]
	u.mu.Unlock()
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

func (u *scriptUpstream) Close() error { close(u.closed); return nil }

func TestRelayCancellationUnblocksReaders(t *testing.T) {
	up := &scriptUpstream{wait: make(chan struct{}), closed: make(chan struct{})}
	client := &memClient{block: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan error, 1)
	go func() { done <- Relay(ctx, client, up) }()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatalf("error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("relay leaked blocked readers")
	}
}

func TestRelayCancellationDuringBlockedReads(t *testing.T) {
	for _, stage := range []string{"starting", "streaming"} {
		t.Run(stage, func(t *testing.T) {
			up := &scriptUpstream{wait: make(chan struct{}), closed: make(chan struct{})}
			client := &memClient{block: make(chan struct{}), ready: make(chan struct{})}
			signal := client.ready
			if stage == "starting" {
				up.startBlock = make(chan struct{})
				signal = up.startBlock
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- Relay(ctx, client, up) }()
			select {
			case <-signal:
			case <-time.After(time.Second):
				t.Fatal("session did not reach expected stage")
			}
			cancel()
			select {
			case err := <-done:
				if err != context.Canceled {
					t.Fatalf("error = %v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("relay leaked blocked readers")
			}
		})
	}
}

func TestRelayDoesNotExposeUpstreamErrors(t *testing.T) {
	up := &scriptUpstream{wait: make(chan struct{}), closed: make(chan struct{}), rejection: "fake-sensitive-upstream-diagnostic"}
	client := &memClient{block: make(chan struct{})}
	err := Relay(context.Background(), client, up)
	if err == nil || strings.Contains(err.Error(), up.rejection) {
		t.Fatalf("error = %v", err)
	}
	if len(client.out) != 1 || client.out[0].Code != "asr_unavailable" || strings.Contains(client.out[0].Message, up.rejection) {
		t.Fatalf("output = %#v", client.out)
	}
}

func TestRelayRejectsOddPCMFrame(t *testing.T) {
	up := &scriptUpstream{wait: make(chan struct{}), closed: make(chan struct{})}
	client := &memClient{block: make(chan struct{}), in: []ClientMessage{{Kind: "audio", Audio: []byte{1}}}}
	if err := Relay(context.Background(), client, up); err == nil {
		t.Fatal("accepted odd PCM frame")
	}
	if len(up.audio) != 0 || client.out[len(client.out)-1].Code != "asr_unavailable" {
		t.Fatalf("output = %#v", client.out)
	}
}

func TestRelayTranslatesMessageProtocol(t *testing.T) {
	up := &scriptUpstream{wait: make(chan struct{}), closed: make(chan struct{})}
	client := &memClient{block: make(chan struct{}), in: []ClientMessage{{Kind: "audio", Audio: []byte{1, 2}}, {Kind: "stop"}}}
	if err := Relay(context.Background(), client, up); err != nil {
		t.Fatal(err)
	}
	if len(up.jsonWrites) != 2 || up.jsonWrites[0]["payload"].(map[string]any)["model"] != modelName {
		t.Fatalf("run = %#v", up.jsonWrites)
	}
	if len(up.audio) != 1 {
		t.Fatalf("audio = %#v", up.audio)
	}
	if len(client.out) < 3 || client.out[0].Type != "ready" || client.out[1].Type != "final" || *client.out[1].StartMS != 170 || client.out[len(client.out)-1].Type != "done" {
		t.Fatalf("phone = %#v", client.out)
	}
}

func TestServerMessagePreservesEmptyTranscriptText(t *testing.T) {
	id := 0
	raw, err := json.Marshal(ServerMessage{Type: "partial", SentenceID: &id})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if text, ok := decoded["text"]; !ok || text != "" {
		t.Fatalf("empty transcript text must remain a string: %s", raw)
	}
}
