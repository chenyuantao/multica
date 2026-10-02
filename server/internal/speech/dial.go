package speech

import (
	"context"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// Dial opens the DashScope realtime socket. The key is sent only on this hop.
func Dial(ctx context.Context, cfg Config) (*websocket.Conn, error) {
	header := http.Header{}
	header.Set("Authorization", "Bearer "+cfg.APIKey)
	header.Set("OpenAI-Beta", "realtime=v1")
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, cfg.endpoint(), header)
	if err != nil {
		return nil, err
	}
	return conn, nil
}
