package imindasr

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
)

type memClient struct {
	in    []ClientMessage
	out   []ServerMessage
	block chan struct{}
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

func (c *memClient) Write(msg ServerMessage) error {
	c.out = append(c.out, msg)
	return nil
}

type scriptUpstream struct {
	mu         sync.Mutex
	jsonWrites []map[string]any
	audio      [][]byte
	pending    []envelope
	wait       chan struct{}
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
		var started envelope
		started.Header.Event = "task-started"
		raw, _ := json.Marshal(started)
		return json.Unmarshal(raw, v)
	}
	for len(u.pending) == 0 {
		u.mu.Unlock()
		<-u.wait
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

func (u *scriptUpstream) Close() error { return nil }

func TestRelayTranslatesMessageProtocol(t *testing.T) {
	up := &scriptUpstream{wait: make(chan struct{})}
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
