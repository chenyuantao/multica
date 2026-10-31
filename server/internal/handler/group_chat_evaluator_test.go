package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/pkg/typesafe"
)

func TestWorkspaceDecisionFailover(t *testing.T) {
	for _, tc := range []struct {
		name                    string
		status                  int
		primary                 string
		key                     string
		keyErr                  error
		fallbackStatus          int
		want                    string
		keyCalls, fallbackCalls int
	}{
		{name: "primary succeeds", status: 200, primary: `{"answers":{"agent":{"type":"choice","choice":"a","confidence":1}}}`, want: "a"},
		{name: "request fails", status: 502, key: "workspace-key", fallbackStatus: 200, want: "b", keyCalls: 1, fallbackCalls: 1},
		{name: "invalid primary choice", status: 200, primary: `{"answers":{"agent":{"type":"choice","choice":"unknown","confidence":1}}}`, key: "workspace-key", fallbackStatus: 200, want: "b", keyCalls: 1, fallbackCalls: 1},
		{name: "malformed primary JSON", status: 200, primary: `not JSON`, key: "workspace-key", fallbackStatus: 200, want: "b", keyCalls: 1, fallbackCalls: 1},
		{name: "missing workspace key", status: 502, keyErr: typesafe.ErrNotConfigured, keyCalls: 1},
		{name: "cannot decrypt key", status: 502, keyErr: errors.New("cannot decrypt"), keyCalls: 1},
		{name: "empty workspace key", status: 502, keyCalls: 1},
		{name: "both providers fail", status: 502, key: "workspace-key", fallbackStatus: 401, keyCalls: 1, fallbackCalls: 1},
		{name: "primary not configured", key: "workspace-key", fallbackStatus: 200, want: "b", keyCalls: 1, fallbackCalls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			keyCalls, fallbackCalls := 0, 0
			var primary groupchat.Evaluator
			if tc.status != 0 {
				primary = typesafe.New(typesafe.Config{APIKey: "jev-key", HTTPClient: &http.Client{Transport: imindNamingTransport(func(*http.Request) (*http.Response, error) {
					return &http.Response{StatusCode: tc.status, Status: http.StatusText(tc.status), Body: io.NopCloser(strings.NewReader(tc.primary))}, nil
				})}})
			}
			ev := &workspaceChatEvaluator{primary: primary, key: func(context.Context) (string, error) { keyCalls++; return tc.key, tc.keyErr }, client: &http.Client{Transport: imindNamingTransport(func(r *http.Request) (*http.Response, error) {
				fallbackCalls++
				if r.Header.Get("Authorization") != "Bearer workspace-key" {
					t.Fatal("wrong workspace credential")
				}
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				content := `{"answers":{"agent":{"type":"choice","choice":"b","confidence":1}}}`
				raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": content}}}})
				return &http.Response{StatusCode: tc.fallbackStatus, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
			})}}
			got, err := groupchat.ChooseAnswerer(context.Background(), ev, groupchat.AskState{Query: "Choose", Agents: []groupchat.AskAgent{{ID: "a", Name: "A"}, {ID: "b", Name: "B"}}})
			if got != tc.want || (err != nil) != (tc.want == "") || keyCalls != tc.keyCalls || fallbackCalls != tc.fallbackCalls {
				t.Fatalf("got=%q err=%v keyCalls=%d fallbackCalls=%d", got, err, keyCalls, fallbackCalls)
			}
		})
	}
}

func TestWorkspaceDecisionDoesNotFailoverCancelledRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ev := &workspaceChatEvaluator{key: func(context.Context) (string, error) { t.Fatal("loaded key for cancelled request"); return "", nil }}
	_, err := ev.Evaluate(ctx, "state", map[string]any{"agent": map[string]any{"type": "choice", "criteria": map[string]string{"a": "A"}}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
}

func TestWorkspaceDecisionReloadsCurrentKey(t *testing.T) {
	currentKey := "workspace-a-key"
	var sent []string
	client := &http.Client{Transport: imindNamingTransport(func(r *http.Request) (*http.Response, error) {
		sent = append(sent, r.Header.Get("Authorization"))
		raw := `{"choices":[{"finish_reason":"stop","message":{"content":"{\"answers\":{\"agent\":{\"type\":\"choice\",\"choice\":\"a\",\"confidence\":1}}}"}}]}`
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(raw))}, nil
	})}
	ev := &workspaceChatEvaluator{key: func(context.Context) (string, error) { return currentKey, nil }, client: client}
	state := groupchat.AskState{Agents: []groupchat.AskAgent{{ID: "a", Name: "A"}, {ID: "b", Name: "B"}}}
	for _, key := range []string{"workspace-a-key", "rotated-key"} {
		currentKey = key
		if _, err := groupchat.ChooseAnswerer(context.Background(), ev, state); err != nil {
			t.Fatal(err)
		}
	}
	other := &workspaceChatEvaluator{key: func(context.Context) (string, error) { return "workspace-b-key", nil }, client: client}
	if _, err := groupchat.ChooseAnswerer(context.Background(), other, state); err != nil {
		t.Fatal(err)
	}
	want := []string{"Bearer workspace-a-key", "Bearer rotated-key", "Bearer workspace-b-key"}
	for i, value := range want {
		if len(sent) != len(want) || sent[i] != value {
			t.Fatalf("workspace credentials were cached or mixed: %v", sent)
		}
	}
}
