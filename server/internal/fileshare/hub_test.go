package fileshare

import (
	"errors"
	"testing"
)

func sharePeer(t *testing.T, owner, daemonID, machine string) *Local {
	t.Helper()
	return NewLocal(ShareMeta{
		DaemonID:    daemonID,
		Machine:     machine,
		OwnerUserID: owner,
		WorkspaceID: "ws-1",
		Visibility:  VisibilityPrivate,
		Enabled:     true,
		Dir:         t.TempDir(),
	}, t.TempDir())
}

func TestHubKeepsOneSharePerMachine(t *testing.T) {
	hub := NewHub()
	laptop := sharePeer(t, "user-1", "daemon-a", "laptop")
	desktop := sharePeer(t, "user-1", "daemon-b", "desktop")
	for _, peer := range []*Local{laptop, desktop} {
		if err := hub.Register(peer); err != nil {
			t.Fatal(err)
		}
	}
	records := hub.Records("user-1", "ws-1")
	if len(records) != 2 || records[0].DaemonID != "daemon-b" || records[1].DaemonID != "daemon-a" {
		t.Fatalf("records = %#v", records)
	}

	// The same machine sharing again replaces its share instead of adding one.
	renamed := sharePeer(t, "user-1", "daemon-a", "laptop-2")
	if err := hub.Register(renamed); err != nil {
		t.Fatal(err)
	}
	records = hub.Records("user-1", "ws-1")
	if len(records) != 2 {
		t.Fatalf("records = %#v", records)
	}
	if hub.Known("laptop") || hub.Get("laptop-2") != renamed {
		t.Fatal("rename did not move the path name")
	}
}

func TestHubPathNameStaysWithItsMachine(t *testing.T) {
	hub := NewHub()
	first := sharePeer(t, "user-1", "daemon-a", "mbp")
	if err := hub.Register(first); err != nil {
		t.Fatal(err)
	}
	if err := hub.Register(sharePeer(t, "user-2", "daemon-c", "mbp")); !errors.Is(err, ErrMachineTaken) {
		t.Fatalf("other user err = %v", err)
	}
	second := sharePeer(t, "user-1", "daemon-b", "mbp")
	if err := hub.Register(second); !errors.Is(err, ErrMachineTaken) {
		t.Fatalf("online name err = %v", err)
	}

	hub.Unregister(first)
	if err := hub.Register(second); err != nil {
		t.Fatalf("offline name err = %v", err)
	}
	records := hub.Records("user-1", "ws-1")
	if len(records) != 1 || records[0].DaemonID != "daemon-b" {
		t.Fatalf("records = %#v", records)
	}
}

func TestHubUpdateAccessByDaemon(t *testing.T) {
	hub := NewHub()
	peer := sharePeer(t, "user-1", "daemon-a", "mbp")
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	off := false
	if _, err := hub.UpdateAccess("user-2", "daemon-a", AccessPatch{Enabled: &off}); err == nil {
		t.Fatal("another user changed the share")
	}
	meta, err := hub.UpdateAccess("user-1", "daemon-a", AccessPatch{Enabled: &off})
	if err != nil || meta.Enabled {
		t.Fatalf("meta = %#v err = %v", meta, err)
	}
	if hub.Get("mbp") != nil {
		t.Fatal("disabled share is still served")
	}
}

func TestHubRenameFollowsNickname(t *testing.T) {
	hub := NewHub()
	peer := sharePeer(t, "user-1", "daemon-a", "host-a")
	other := sharePeer(t, "user-1", "daemon-b", "studio")
	for _, p := range []*Local{peer, other} {
		if err := hub.Register(p); err != nil {
			t.Fatal(err)
		}
	}
	if err := hub.Rename("ws-1", "daemon-a", "Tao Mac"); err != nil {
		t.Fatal(err)
	}
	if hub.Known("host-a") || hub.Get("Tao Mac") != peer || peer.Meta().Machine != "Tao Mac" {
		t.Fatalf("records = %#v", hub.Records("user-1", "ws-1"))
	}
	if err := hub.Rename("ws-1", "daemon-a", "studio"); !errors.Is(err, ErrMachineTaken) {
		t.Fatalf("taken name err = %v", err)
	}
	if hub.Get("Tao Mac") != peer {
		t.Fatal("refused rename moved the share")
	}
	if err := hub.Rename("ws-1", "daemon-a", ""); err != nil {
		t.Fatal(err)
	}
	if hub.Get("host-a") != peer {
		t.Fatal("cleared nickname did not restore the daemon's name")
	}
	if err := hub.Rename("ws-2", "daemon-a", "elsewhere"); err != nil || hub.Known("elsewhere") {
		t.Fatalf("rename in another workspace moved the share: %v", err)
	}
}

func TestMachineName(t *testing.T) {
	cases := map[string]string{
		"  Tao's Mac  ": "Tao's Mac",
		"Tao/Studio":    "Tao-Studio",
		"a..b":          "a.b",
		"..":            "",
		"system":        "",
		"  ":            "",
		"x\ty":          "xy",
	}
	for in, want := range cases {
		if got := MachineName(in); got != want {
			t.Errorf("MachineName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRegisterRequiresDaemonID(t *testing.T) {
	if err := NewHub().Register(sharePeer(t, "user-1", "", "mbp")); err == nil {
		t.Fatal("share without a daemon id was accepted")
	}
}
