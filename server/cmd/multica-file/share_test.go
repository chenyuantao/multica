package main

import (
	"path/filepath"
	"testing"

	"github.com/multica-ai/multica/server/internal/cli"
)

func TestShareConfigRoundTrip(t *testing.T) {
	t.Setenv(cli.TaskConfigRootEnv, t.TempDir())
	cfg := shareConfig{Dir: "/tmp/notes", Machine: "mbp", Visibility: "private", WorkspaceID: "ws"}
	if err := saveShare("", cfg); err != nil {
		t.Fatal(err)
	}
	got, err := loadShare("")
	if err != nil {
		t.Fatal(err)
	}
	if got != cfg {
		t.Fatalf("got %#v", got)
	}
	path, err := shareConfigPath("")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "file-share.json" {
		t.Fatalf("path = %s", path)
	}
}

func TestShareSocketURL(t *testing.T) {
	got, err := shareSocketURL("https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	if got != "wss://example.com/api/file-shares/connect" {
		t.Fatalf("got %s", got)
	}
}
