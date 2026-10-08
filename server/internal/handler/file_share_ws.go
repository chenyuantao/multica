package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
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
	if nickname := h.machineNickname(r.Context(), meta.WorkspaceID, meta.DaemonID); nickname != "" {
		session.SetMachine(nickname)
		err = h.FileShares.Register(session)
		if errors.Is(err, fileshare.ErrMachineTaken) {
			session.SetMachine(meta.DefaultMachine)
			err = h.FileShares.Register(session)
		}
	} else {
		err = h.FileShares.Register(session)
	}
	if err != nil {
		fail(err.Error())
		return
	}
	if err := conn.WriteJSON(fileshare.Envelope{Type: "ready", Machine: session.Meta().Machine}); err != nil {
		h.FileShares.Unregister(session)
		session.Close()
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	go session.ReadLoop(func() { h.FileShares.Unregister(session) })
}

// machineNickname is the knowledge path prefix taken from the machine name set
// on the runtime page, or "" when the machine has none.
func (h *Handler) machineNickname(ctx context.Context, workspaceID, daemonID string) string {
	if h.Queries == nil || workspaceID == "" {
		return ""
	}
	wsUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		return ""
	}
	names, err := h.Queries.ListMachineCustomNames(ctx, db.ListMachineCustomNamesParams{
		WorkspaceID: wsUUID,
		DaemonID:    pgtype.Text{String: daemonID, Valid: true},
	})
	if err != nil {
		slog.Warn("file share: load machine name", "error", err, "daemon_id", daemonID)
		return ""
	}
	nickname, ok := sharedDaemonCustomName(names)
	if !ok {
		return ""
	}
	return fileshare.MachineName(nickname)
}

// renameFileShares moves a machine's shares to its current runtime nickname.
func (h *Handler) renameFileShares(ctx context.Context, rt db.AgentRuntime) {
	if h.FileShares == nil || !rt.DaemonID.Valid {
		return
	}
	workspaceID := uuidToString(rt.WorkspaceID)
	nickname := h.machineNickname(ctx, workspaceID, rt.DaemonID.String)
	if err := h.FileShares.Rename(workspaceID, rt.DaemonID.String, nickname); err != nil {
		slog.Warn("file share: rename", "error", err, "daemon_id", rt.DaemonID.String)
	}
}
