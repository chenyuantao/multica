package obsidianvault

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestParseVersions(t *testing.T) {
	raw := "version time\n1\t2026-09-29 16:00\n2 2026-09-28\n\nnot-a-version\n"
	got := parseVersions(raw, "local")
	if len(got) != 2 || got[0].Version != 1 || got[0].Source != "local" || got[1].Version != 2 {
		t.Fatalf("versions = %#v", got)
	}
	if got[0].Label != "2026-09-29 16:00" {
		t.Fatalf("label = %q", got[0].Label)
	}
}

func TestFindRevisionReadsCLIHistory(t *testing.T) {
	root := t.TempDir()
	base := "local snapshot"
	writeFile(t, root, "note.md", "synced text")
	orig := runCLI
	runCLI = func(_ context.Context, _ string, args []string) (string, error) {
		switch args[0] {
		case "history":
			return "1\tfile recovery\n", nil
		case "history:read":
			return base, nil
		case "sync:history":
			return "", ErrCLIFailed
		default:
			return "", ErrCLIFailed
		}
	}
	t.Cleanup(func() { runCLI = orig })

	got, err := FindRevision(context.Background(), root, "note.md", contentRevision([]byte(base)))
	if err != nil {
		t.Fatal(err)
	}
	if got != base {
		t.Fatalf("found = %q", got)
	}

	runCLI = func(context.Context, string, []string) (string, error) {
		return "", ErrCLIUnavailable
	}
	_, err = History(context.Background(), root, "note.md")
	if !errors.Is(err, ErrCLIUnavailable) {
		t.Fatalf("history err = %v", err)
	}
	if strings.Contains(base, "synced") {
		t.Fatal("fixture mixed")
	}
}
