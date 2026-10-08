package handler

import (
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/fileshare"
)

var fileShareUpgrader = websocket.Upgrader{
	CheckOrigin: func(*http.Request) bool { return true },
}

// ConnectFileShare attaches a multica-file daemon. The socket stays open and
// the server asks it for listings and file bodies as the knowledge API is used.
func (h *Handler) ConnectFileShare(w http.ResponseWriter, r *http.Request) {
	if h.FileShares == nil {
		writeError(w, http.StatusServiceUnavailable, "file shares are not available")
		return
	}
	ownerID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	conn, err := fileShareUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	fail := func(message string) {
		_ = conn.WriteJSON(map[string]any{
			"type":  "error",
			"error": map[string]string{"message": message},
		})
		_ = conn.Close()
	}
	_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	var hello fileshare.Envelope
	if err := conn.ReadJSON(&hello); err != nil {
		_ = conn.Close()
		return
	}
	meta, err := fileshare.AcceptHello(hello, ownerID)
	if err != nil {
		fail(err.Error())
		return
	}
	if meta.WorkspaceID != "" && h.Queries != nil && !h.userInWorkspace(r.Context(), ownerID, meta.WorkspaceID) {
		fail("not a member of that workspace")
		return
	}
	session := fileshare.NewSession(conn, meta)
	if err := h.FileShares.Register(session); err != nil {
		fail(err.Error())
		return
	}
	if err := conn.WriteJSON(fileshare.Envelope{Type: "ready"}); err != nil {
		h.FileShares.Unregister(session)
		session.Close()
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	go session.ReadLoop(func() { h.FileShares.Unregister(session) })
}
