package fileshare

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

// Envelope is one websocket message. The daemon sends hello, then answers
// request messages with response messages. File bytes travel only inside a
// response payload.
type Envelope struct {
	Type        string          `json:"type"`
	ID          string          `json:"id,omitempty"`
	Op          string          `json:"op,omitempty"`
	Machine     string          `json:"machine,omitempty"`
	WorkspaceID string          `json:"workspace_id,omitempty"`
	Visibility  string          `json:"visibility,omitempty"`
	Dir         string          `json:"dir,omitempty"`
	Enabled     *bool           `json:"enabled,omitempty"`
	OK          bool            `json:"ok,omitempty"`
	Error       *codedError     `json:"error,omitempty"`
	Payload     json.RawMessage `json:"payload,omitempty"`
}

// Session is a live websocket to one multica-file daemon.
type Session struct {
	metaMu sync.Mutex
	meta   ShareMeta

	conn    *websocket.Conn
	writeMu sync.Mutex

	pendingMu sync.Mutex
	pending   map[string]chan Envelope
	seq       uint64
	closed    chan struct{}
	closeOnce sync.Once
}

func NewSession(conn *websocket.Conn, meta ShareMeta) *Session {
	return &Session{
		meta:    meta,
		conn:    conn,
		pending: map[string]chan Envelope{},
		closed:  make(chan struct{}),
	}
}

func (s *Session) Meta() ShareMeta {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	return s.meta
}

func (s *Session) SetAccess(visibility string, enabled bool) {
	s.metaMu.Lock()
	s.meta.Visibility = visibility
	s.meta.Enabled = enabled
	s.metaMu.Unlock()
}

func (s *Session) PushAccess(visibility string, enabled bool) error {
	s.SetAccess(visibility, enabled)
	return s.write(Envelope{Type: "config", Visibility: visibility, Enabled: &enabled})
}

func (s *Session) Close() {
	s.closeOnce.Do(func() {
		close(s.closed)
		_ = s.conn.Close()
	})
}

func (s *Session) Call(ctx context.Context, op string, payload any, dest any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	s.pendingMu.Lock()
	s.seq++
	id := jsonID(s.seq)
	ch := make(chan Envelope, 1)
	s.pending[id] = ch
	s.pendingMu.Unlock()
	defer func() {
		s.pendingMu.Lock()
		delete(s.pending, id)
		s.pendingMu.Unlock()
	}()

	if err := s.write(Envelope{Type: "request", ID: id, Op: op, Payload: raw}); err != nil {
		return err
	}
	select {
	case env := <-ch:
		if env.Error != nil {
			return decodeError(env.Error)
		}
		if dest == nil || len(env.Payload) == 0 {
			return nil
		}
		return json.Unmarshal(env.Payload, dest)
	case <-s.closed:
		return context.Canceled
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Session) write(env Envelope) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	return s.conn.WriteJSON(env)
}

func (s *Session) deliver(env Envelope) {
	s.pendingMu.Lock()
	ch := s.pending[env.ID]
	s.pendingMu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- env:
	default:
	}
}

func (s *Session) ReadLoop(onClose func()) {
	defer onClose()
	defer s.Close()
	for {
		var env Envelope
		if err := s.conn.ReadJSON(&env); err != nil {
			return
		}
		if env.Type == "response" {
			s.deliver(env)
		}
	}
}

// ServeConn answers request envelopes by running them on root. It returns
// when the connection closes or ctx is canceled.
// ConfigUpdate is an access change pushed by the runtime UI.
type ConfigUpdate struct {
	Visibility string
	Enabled    bool
}

func ServeConn(ctx context.Context, conn *websocket.Conn, root string, onConfig func(ConfigUpdate)) error {
	var writeMu sync.Mutex
	write := func(env Envelope) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
		return conn.WriteJSON(env)
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()
	defer close(done)
	for {
		var env Envelope
		if err := conn.ReadJSON(&env); err != nil {
			return err
		}
		if env.Type == "config" {
			if onConfig != nil {
				enabled := true
				if env.Enabled != nil {
					enabled = *env.Enabled
				}
				onConfig(ConfigUpdate{Visibility: env.Visibility, Enabled: enabled})
			}
			continue
		}
		if env.Type != "request" {
			continue
		}
		go func(env Envelope) {
			result, err := Exec(ctx, root, env.Op, env.Payload)
			resp := Envelope{Type: "response", ID: env.ID, OK: err == nil}
			if err != nil {
				resp.Error = encodeError(err)
			} else {
				raw, marshalErr := json.Marshal(result)
				if marshalErr != nil {
					resp.OK = false
					resp.Error = encodeError(marshalErr)
				} else {
					resp.Payload = raw
				}
			}
			_ = write(resp)
		}(env)
	}
}

// ErrorText is the server's rejection message, or fallback when there is none.
func (e Envelope) ErrorText(fallback string) string {
	if e.Error != nil && e.Error.Message != "" {
		return e.Error.Message
	}
	if fallback != "" {
		return fallback
	}
	return "file share request failed"
}

func jsonID(n uint64) string {
	const digits = "0123456789"
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = digits[n%10]
		n /= 10
	}
	return string(buf[i:])
}

// AcceptHello reads the daemon's first message. The owner is the authenticated
// user, never a value from the message.
func AcceptHello(env Envelope, ownerUserID string) (ShareMeta, error) {
	if env.Type != "hello" {
		return ShareMeta{}, obsidianvault.ErrInvalidPath
	}
	machine, err := SanitizeMachine(env.Machine)
	if err != nil {
		return ShareMeta{}, err
	}
	visibility, err := NormalizeVisibility(env.Visibility)
	if err != nil {
		return ShareMeta{}, err
	}
	if visibility == VisibilityWorkspace && env.WorkspaceID == "" {
		return ShareMeta{}, errBadVisibility
	}
	enabled := true
	if env.Enabled != nil {
		enabled = *env.Enabled
	}
	return ShareMeta{
		Machine:     machine,
		OwnerUserID: ownerUserID,
		WorkspaceID: env.WorkspaceID,
		Visibility:  visibility,
		Dir:         strings.TrimSpace(env.Dir),
		Enabled:     enabled,
		Online:      true,
	}, nil
}
