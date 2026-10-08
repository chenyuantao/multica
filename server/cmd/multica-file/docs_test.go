package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/cli"
)

type docsCallRecord struct {
	Method string
	Path   string
	Body   map[string]any
}

// fakeDocsServer serves /api/docs from an in-memory set of notes and records
// every call, so tests see which requests a command sent.
func fakeDocsServer(t *testing.T, notes map[string]string) *[]docsCallRecord {
	t.Helper()
	var calls []docsCallRecord
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer mat_task" {
			t.Errorf("Authorization = %q", got)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		calls = append(calls, docsCallRecord{Method: r.Method, Path: r.URL.Path, Body: body})
		path, _ := body["path"].(string)
		notFound := func() {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "document not found", "code": "docs_not_found"})
		}
		writeNote := func(status int) {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{"path": path, "content": notes[path], "revision": "rev-" + notes[path]})
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /api/docs/children":
			_ = json.NewEncoder(w).Encode(map[string]any{"path": path, "nodes": []map[string]string{
				{"name": "notes", "path": "mbp/notes", "type": "dir"},
				{"name": "a.md", "path": "mbp/a.md", "type": "file"},
			}})
		case "POST /api/docs/files/content":
			if _, ok := notes[path]; !ok {
				notFound()
				return
			}
			writeNote(http.StatusOK)
		case "POST /api/docs/files":
			notes[path], _ = body["content"].(string)
			writeNote(http.StatusCreated)
		case "PATCH /api/docs/files/content":
			current, ok := notes[path]
			if !ok {
				notFound()
				return
			}
			content, _ := body["content"].(string)
			switch body["op"] {
			case "append":
				notes[path] = current + content
			case "overwrite":
				if body["base_revision"] != "rev-"+current {
					w.WriteHeader(http.StatusConflict)
					_ = json.NewEncoder(w).Encode(map[string]string{"error": "document changed since it was loaded", "code": "docs_conflict"})
					return
				}
				notes[path] = content
			}
			writeNote(http.StatusOK)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	t.Setenv(cli.TaskConfigRootEnv, t.TempDir())
	t.Setenv("MULTICA_SERVER_URL", srv.URL)
	t.Setenv("MULTICA_TOKEN", "mat_task")
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	return &calls
}

func runFileCmd(t *testing.T, args ...string) (string, error) {
	t.Helper()
	stdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	root := newRoot()
	root.SetArgs(args)
	root.SetErr(io.Discard)
	runErr := root.Execute()
	w.Close()
	os.Stdout = stdout
	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	return buf.String(), runErr
}

func TestWriteCreatesThenOverwritesAtTheReadRevision(t *testing.T) {
	notes := map[string]string{}
	calls := fakeDocsServer(t, notes)

	if out, err := runFileCmd(t, "write", "mbp/a.md", "--content", "one"); err != nil || out != "wrote mbp/a.md (revision rev-one)\n" {
		t.Fatalf("create: out=%q err=%v", out, err)
	}
	if _, err := runFileCmd(t, "write", "mbp/a.md", "--content", "two"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	if notes["mbp/a.md"] != "two" {
		t.Fatalf("note = %q", notes["mbp/a.md"])
	}
	last := (*calls)[len(*calls)-1]
	if last.Method != http.MethodPatch || last.Body["op"] != "overwrite" || last.Body["base_revision"] != "rev-one" {
		t.Fatalf("overwrite call = %#v", last)
	}

	_, err := runFileCmd(t, "write", "mbp/a.md", "--content", "three", "--base-revision", "rev-one")
	if docsErrorCode(err) != "docs_conflict" || !strings.Contains(err.Error(), "read the note again") {
		t.Fatalf("stale revision err = %v", err)
	}
}

func TestWriteAppendCreatesAMissingNote(t *testing.T) {
	notes := map[string]string{}
	fakeDocsServer(t, notes)

	if _, err := runFileCmd(t, "write", "mbp/log.md", "--content", "a", "--append"); err != nil {
		t.Fatal(err)
	}
	if _, err := runFileCmd(t, "write", "mbp/log.md", "--content", "b", "--append"); err != nil {
		t.Fatal(err)
	}
	if notes["mbp/log.md"] != "ab" {
		t.Fatalf("note = %q", notes["mbp/log.md"])
	}
}

func TestWriteNeedsContent(t *testing.T) {
	fakeDocsServer(t, map[string]string{})
	if _, err := runFileCmd(t, "write", "mbp/a.md"); err == nil || !strings.Contains(err.Error(), "--content, --file, or --stdin") {
		t.Fatalf("err = %v", err)
	}
}

func TestReadAndLs(t *testing.T) {
	fakeDocsServer(t, map[string]string{"mbp/a.md": "# A\n"})

	if out, err := runFileCmd(t, "read", "mbp/a.md"); err != nil || out != "# A\n" {
		t.Fatalf("read: out=%q err=%v", out, err)
	}
	_, err := runFileCmd(t, "read", "mbp/missing.md")
	if docsErrorCode(err) != "docs_not_found" || !strings.Contains(err.Error(), "multica-file ls") {
		t.Fatalf("missing err = %v", err)
	}
	if out, err := runFileCmd(t, "ls", "mbp"); err != nil || out != "mbp/notes/\nmbp/a.md\n" {
		t.Fatalf("ls: out=%q err=%v", out, err)
	}
}
