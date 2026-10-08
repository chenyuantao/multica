package main

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func writeDaemonDir(t *testing.T, home, name, id string, alive bool, config string) {
	t.Helper()
	dir := filepath.Join(home, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "daemon.id"), []byte(id+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	pid := 999999999
	if alive {
		pid = os.Getpid()
	}
	if err := os.WriteFile(filepath.Join(dir, "daemon.pid"), []byte(strconv.Itoa(pid)), 0o600); err != nil {
		t.Fatal(err)
	}
	if config != "" {
		if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(config), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPickDaemonIDPrefersTheRunningRebrandedDaemon(t *testing.T) {
	home := t.TempDir()
	writeDaemonDir(t, home, ".multica", "multica-id", false, `{"workspace_id":"ws-1"}`)
	writeDaemonDir(t, home, ".imultica", "imultica-id", true, "")
	if got := pickDaemonID(home, shareConfig{WorkspaceID: "ws-1"}); got != "imultica-id" {
		t.Fatalf("got %q", got)
	}
}

func TestPickDaemonIDFallsBackToTheShareWorkspace(t *testing.T) {
	home := t.TempDir()
	writeDaemonDir(t, home, ".multica", "multica-id", false, `{"workspace_id":"ws-dev"}`)
	writeDaemonDir(t, home, ".imultica", "imultica-id", false, `{"workspace_id":"ws-1"}`)
	if got := pickDaemonID(home, shareConfig{WorkspaceID: "ws-1"}); got != "imultica-id" {
		t.Fatalf("got %q", got)
	}
	if got := pickDaemonID(home, shareConfig{}); got != "multica-id" {
		t.Fatalf("tie got %q, want ~/.multica", got)
	}
}

func TestServerAssignedRoot(t *testing.T) {
	cfg := shareConfig{Machine: "host-a"}
	if got := rootInUse(cfg, "Tao Mac"); got != "Tao Mac" {
		t.Fatalf("nickname root = %q", got)
	}
	cfg.Root = "Tao Mac"
	if cfg.knowledgeRoot() != "Tao Mac" {
		t.Fatalf("knowledgeRoot = %q", cfg.knowledgeRoot())
	}
	if rootInUse(cfg, "host-a") != "" || rootInUse(cfg, "") != "" {
		t.Fatal("the proposed name or an older server should clear Root")
	}
}

func TestShareConfigSameComparesEnabledByValue(t *testing.T) {
	on, alsoOn, off := true, true, false
	a := shareConfig{Dir: "/d", Machine: "m", Enabled: &on}
	if !a.same(shareConfig{Dir: "/d", Machine: "m", Enabled: &alsoOn}) || !a.same(shareConfig{Dir: "/d", Machine: "m"}) {
		t.Fatal("equal configs compared as changed")
	}
	if a.same(shareConfig{Dir: "/d", Machine: "m", Enabled: &off}) || a.same(shareConfig{Dir: "/e", Machine: "m", Enabled: &on}) {
		t.Fatal("changed configs compared as equal")
	}
}

func TestPickDaemonIDWithoutDaemonDirs(t *testing.T) {
	if got := pickDaemonID(t.TempDir(), shareConfig{}); got != "" {
		t.Fatalf("got %q", got)
	}
}
