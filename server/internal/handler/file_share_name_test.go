package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/fileshare"
)

func TestFileShareRootFollowsMachineNickname(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	_, ownerID, _ := runtimeVisibilityFixture(t)
	ctx := context.Background()
	const daemonID = "file-share-name-daemon"
	var runtimeIDs []string
	for _, provider := range []string{"fsn_a", "fsn_b"} {
		var id string
		if err := testPool.QueryRow(ctx, `
			INSERT INTO agent_runtime (
				workspace_id, daemon_id, name, runtime_mode, provider, status,
				device_info, metadata, owner_id, visibility, last_seen_at
			)
			VALUES ($1, $2, $3, 'local', $4, 'online', 'host', '{}'::jsonb, $5, 'private', now())
			RETURNING id
		`, testWorkspaceID, daemonID, provider+" (host)", provider, ownerID).Scan(&id); err != nil {
			t.Fatalf("create runtime %s: %v", provider, err)
		}
		t.Cleanup(func() {
			testPool.Exec(context.Background(), `DELETE FROM agent_runtime WHERE id = $1`, id)
		})
		runtimeIDs = append(runtimeIDs, id)
	}

	hub := fileshare.NewHub()
	previous := testHandler.FileShares
	testHandler.FileShares = hub
	t.Cleanup(func() { testHandler.FileShares = previous })

	root := t.TempDir()
	peer := fileshare.NewLocal(fileshare.ShareMeta{
		DaemonID:    daemonID,
		Machine:     "host-a",
		OwnerUserID: ownerID,
		WorkspaceID: testWorkspaceID,
		Visibility:  fileshare.VisibilityPrivate,
		Enabled:     true,
	}, root)
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}

	w := patchRuntimeCustomName(ownerID, runtimeIDs[0], map[string]any{
		"custom_name":      "Tao/Studio",
		"apply_to_machine": true,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", w.Code, w.Body.String())
	}
	if hub.Get("Tao-Studio") == nil || hub.Known("host-a") {
		t.Fatalf("share was not moved to the nickname: %#v", hub.Records(ownerID, testWorkspaceID))
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("X-User-ID", ownerID)
		testHandler.ConnectFileShare(w, r)
	}))
	defer srv.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(fileshare.Envelope{
		Type:        "hello",
		DaemonID:    daemonID,
		Machine:     "host-a",
		WorkspaceID: testWorkspaceID,
		Visibility:  fileshare.VisibilityPrivate,
	}); err != nil {
		t.Fatal(err)
	}
	var ready fileshare.Envelope
	if err := conn.ReadJSON(&ready); err != nil {
		t.Fatal(err)
	}
	if ready.Type != "ready" || ready.Machine != "Tao-Studio" {
		t.Fatalf("ready = %#v", ready)
	}

	w = patchRuntimeCustomName(ownerID, runtimeIDs[0], map[string]any{
		"custom_name":      "",
		"apply_to_machine": true,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("clear name: %d %s", w.Code, w.Body.String())
	}
	var config fileshare.Envelope
	if err := conn.ReadJSON(&config); err != nil {
		t.Fatal(err)
	}
	if config.Type != "config" || config.Machine != "host-a" {
		t.Fatalf("config = %#v", config)
	}
	if hub.Get("host-a") == nil {
		t.Fatalf("share did not return to the daemon's name: %#v", hub.Records(ownerID, testWorkspaceID))
	}
}
