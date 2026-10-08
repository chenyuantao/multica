package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/cli"
)

func TestResolveSharePath(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := shareConfig{Dir: root, Machine: "mbp"}

	local, rel, err := resolveSharePath(cfg, filepath.Join(root, "notes", "a.md"))
	if err != nil || rel != "notes/a.md" || local != filepath.Join(root, "notes", "a.md") {
		t.Fatalf("local form: local=%q rel=%q err=%v", local, rel, err)
	}

	local, rel, err = resolveSharePath(cfg, "mbp/notes/a.md")
	if err != nil || rel != "notes/a.md" || local != filepath.Join(root, "notes", "a.md") {
		t.Fatalf("knowledge form: local=%q rel=%q err=%v", local, rel, err)
	}

	if _, _, err := resolveSharePath(cfg, "mbp/../etc/passwd"); !errors.Is(err, errOutsideShare) {
		t.Fatalf("parent in knowledge path err = %v", err)
	}
	if _, _, err := resolveSharePath(cfg, t.TempDir()); !errors.Is(err, errOutsideShare) {
		t.Fatalf("outside err = %v", err)
	}

	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(root, link); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	if _, rel, err := resolveSharePath(cfg, filepath.Join(link, "notes", "new.md")); err != nil || rel != "notes/new.md" {
		t.Fatalf("through symlink: rel=%q err=%v", rel, err)
	}
}

func TestKnowledgeFilter(t *testing.T) {
	cases := map[string]struct {
		rel    string
		isDir  bool
		listed bool
	}{
		"markdown":         {rel: "notes/a.md", listed: true},
		"upper markdown":   {rel: "A.MD", listed: true},
		"directory":        {rel: "notes", isDir: true, listed: true},
		"root":             {rel: "", isDir: true, listed: true},
		"not markdown":     {rel: "notes/a.txt"},
		"hidden file":      {rel: ".obsidian/a.md"},
		"skipped dir":      {rel: "node_modules/pkg/readme.md"},
		"skipped dir self": {rel: "build", isDir: true},
		"file named build": {rel: "notes/build.md", listed: true},
	}
	for name, tc := range cases {
		if got := knowledgeFilter(tc.rel, tc.isDir) == ""; got != tc.listed {
			t.Errorf("%s: listed = %v, want %v (%q)", name, got, tc.listed, knowledgeFilter(tc.rel, tc.isDir))
		}
	}
}

func TestFindShareInsideTaskReadsTheMachineShare(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv(cli.TaskConfigRootEnv, t.TempDir())
	t.Setenv("MULTICA_SERVER_URL", "https://multica.example/")
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	writeShare := func(path string, cfg shareConfig) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(cfg)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	base := filepath.Join(home, ".multica")
	writeShare(filepath.Join(base, "file-share.json"), shareConfig{Dir: "/other", Machine: "other", ServerURL: "https://elsewhere.example", WorkspaceID: "ws-1"})
	writeShare(filepath.Join(base, "profiles", "work", "file-share.json"), shareConfig{Dir: "/notes", Machine: "mbp", ServerURL: "https://multica.example", WorkspaceID: "ws-1"})

	cfg, pidFile, err := findShare("")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Dir != "/notes" || pidFile != filepath.Join(base, "profiles", "work", "file-daemon.pid") {
		t.Fatalf("cfg = %#v pid = %s", cfg, pidFile)
	}

	t.Setenv("MULTICA_WORKSPACE_ID", "ws-2")
	_, _, err = findShare("")
	var notShared *notSharedError
	if !errors.As(err, &notShared) || !strings.Contains(notShared.reason, "mbp/") || !strings.Contains(notShared.reason, "another server or workspace") {
		t.Fatalf("other workspace err = %v", err)
	}
}

func TestPathCommandSaysWhenNothingWasShared(t *testing.T) {
	for name, task := range map[string]bool{"cli": false, "agent task": true} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			t.Setenv("MULTICA_DAEMON_ID", "daemon-1")
			taskRoot := ""
			if task {
				taskRoot = t.TempDir()
			}
			t.Setenv(cli.TaskConfigRootEnv, taskRoot)

			out, err := runPathRaw(t, "--json")
			if !errors.Is(err, errNotShared) {
				t.Fatalf("err = %v", err)
			}
			var report noShareReport
			if err := json.Unmarshal(out, &report); err != nil {
				t.Fatalf("decode %q: %v", out, err)
			}
			if report.Shared || report.DaemonID != "daemon-1" || !strings.Contains(report.Reason, "never shared a directory") {
				t.Fatalf("report = %#v", report)
			}

			text, err := runPathRaw(t, "notes/a.md")
			if !errors.Is(err, errNotShared) || !strings.HasPrefix(string(text), "shared: no\nreason: this machine has never shared a directory") {
				t.Fatalf("text = %q err = %v", text, err)
			}
		})
	}
}

func TestPathCommandReportsAndFailsOutsideKnowledge(t *testing.T) {
	t.Setenv(cli.TaskConfigRootEnv, "")
	t.Setenv("HOME", t.TempDir())
	t.Setenv("MULTICA_DAEMON_ID", "daemon-1")
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := saveShare("", shareConfig{Dir: root, Machine: "mbp", Visibility: "private"}); err != nil {
		t.Fatal(err)
	}

	report, err := runPathJSON(t, "--offline", filepath.Join(root, "a.md"))
	if err != nil {
		t.Fatal(err)
	}
	if report.Knowledge != "mbp/a.md" || report.KnowledgeRoot != "mbp/" || report.DaemonID != "daemon-1" || report.Listed == nil || !*report.Listed {
		t.Fatalf("report = %#v", report)
	}

	report, err = runPathJSON(t, "--offline", "mbp/a.txt")
	if err == nil || report.Listed == nil || *report.Listed || report.Reason != "only Markdown (.md) files are shared" {
		t.Fatalf("non-markdown: report = %#v err = %v", report, err)
	}

	report, err = runPathJSON(t, "--offline", "mbp/missing.md")
	if err == nil || report.Exists == nil || *report.Exists || report.Reason != "does not exist on disk" {
		t.Fatalf("missing: report = %#v err = %v", report, err)
	}
	if _, err := runPathJSON(t, "--offline", t.TempDir()); !errors.Is(err, errOutsideShare) {
		t.Fatalf("outside err = %v", err)
	}
}

func runPathJSON(t *testing.T, args ...string) (pathReport, error) {
	t.Helper()
	out, runErr := runPathRaw(t, append([]string{"--json"}, args...)...)
	var report pathReport
	if len(out) > 0 {
		if err := json.Unmarshal(out, &report); err != nil {
			t.Fatalf("decode %q: %v", out, err)
		}
	}
	return report, runErr
}

func runPathRaw(t *testing.T, args ...string) ([]byte, error) {
	t.Helper()
	stdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	root := newRoot()
	root.SetArgs(append([]string{"path"}, args...))
	root.SetErr(io.Discard)
	runErr := root.Execute()
	w.Close()
	os.Stdout = stdout
	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	return buf.Bytes(), runErr
}
