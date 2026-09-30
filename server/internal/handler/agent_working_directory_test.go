package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormaliseAgentWorkingDirectory(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    string
		wantErr bool
	}{
		{name: "empty clears", in: "", want: ""},
		{name: "whitespace clears", in: "   ", want: ""},
		{name: "posix absolute is trimmed", in: "  /Users/me/proj  ", want: "/Users/me/proj"},
		{name: "windows drive backslash", in: `C:\code\proj`, want: `C:\code\proj`},
		{name: "windows drive forward slash", in: "D:/code/proj", want: "D:/code/proj"},
		{name: "windows unc", in: `\\server\share\proj`, want: `\\server\share\proj`},
		{name: "relative rejected", in: "code/proj", wantErr: true},
		{name: "home shorthand rejected", in: "~/proj", wantErr: true},
		{name: "drive relative rejected", in: "C:proj", wantErr: true},
		{name: "nul rejected", in: "/tmp/a\x00b", wantErr: true},
		{name: "too long rejected", in: "/" + strings.Repeat("a", maxAgentWorkingDirectoryLength), wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normaliseAgentWorkingDirectory(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestAgentWorkingDirectoryTriState(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	runtimeID := createClaudeProviderRuntime(t)

	body := map[string]any{
		"name":                 "working-directory-create",
		"runtime_id":           runtimeID,
		"visibility":           "private",
		"max_concurrent_tasks": 1,
		"working_directory":    " /srv/proj ",
	}
	w := httptest.NewRecorder()
	testHandler.CreateAgent(w, newRequest(http.MethodPost, "/api/agents", body))
	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created map[string]any
	_ = json.NewDecoder(w.Body).Decode(&created)
	agentID, _ := created["id"].(string)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM agent WHERE id = $1`, agentID)
	})
	if created["working_directory"] != "/srv/proj" {
		t.Fatalf("created working_directory = %v, want /srv/proj", created["working_directory"])
	}

	patch := func(t *testing.T, payload map[string]any) (int, map[string]any) {
		t.Helper()
		rec := httptest.NewRecorder()
		req := withURLParam(newRequest(http.MethodPatch, "/api/agents/"+agentID, payload), "id", agentID)
		testHandler.UpdateAgent(rec, req)
		var out map[string]any
		_ = json.NewDecoder(rec.Body).Decode(&out)
		return rec.Code, out
	}

	if code, out := patch(t, map[string]any{"name": "working-directory-renamed"}); code != http.StatusOK || out["working_directory"] != "/srv/proj" {
		t.Fatalf("omitted field: code=%d working_directory=%v, want 200 and preserved", code, out["working_directory"])
	}
	if code, _ := patch(t, map[string]any{"working_directory": "relative/proj"}); code != http.StatusBadRequest {
		t.Fatalf("relative path: expected 400, got %d", code)
	}
	if code, out := patch(t, map[string]any{"working_directory": `C:\work\proj`}); code != http.StatusOK || out["working_directory"] != `C:\work\proj` {
		t.Fatalf("set: code=%d working_directory=%v", code, out["working_directory"])
	}
	if code, out := patch(t, map[string]any{"working_directory": ""}); code != http.StatusOK || out["working_directory"] != "" {
		t.Fatalf("clear: code=%d working_directory=%v, want 200 and empty", code, out["working_directory"])
	}
}
