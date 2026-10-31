package groupchat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type decisionTransport func(*http.Request) (*http.Response, error)

func (f decisionTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func decisionQuestions() map[string]any {
	return map[string]any{"agent": map[string]any{"type": "choice", "instructions": "Select an agent", "criteria": map[string]string{"writer": "Writes notes", "coder": "Writes code"}}}
}

func TestDeepSeekDecisionJSONContract(t *testing.T) {
	client := &http.Client{Transport: decisionTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.deepseek.com/chat/completions" || r.Header.Get("Authorization") != "Bearer workspace-key" {
			t.Fatal("unexpected endpoint or credential")
		}
		var payload struct {
			Model          string `json:"model"`
			ResponseFormat struct {
				Type string `json:"type"`
			} `json:"response_format"`
			Messages []struct{ Role, Content string } `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Model != "deepseek-flash" || payload.ResponseFormat.Type != "json_object" || len(payload.Messages) != 2 || !strings.Contains(payload.Messages[0].Content, "JSON") {
			t.Fatalf("unexpected JSON request: %+v", payload)
		}
		if !strings.Contains(payload.Messages[1].Content, "Write a note") || !strings.Contains(payload.Messages[1].Content, "writer") {
			t.Fatal("state or questions missing")
		}
		content := `{"answers":{"agent":{"type":"choice","choice":"writer","confidence":0.98}}}`
		raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": content}}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	})}
	ev := &DeepSeekEvaluator{APIKey: "workspace-key", HTTPClient: client}
	id, err := ChooseAnswerer(context.Background(), ev, AskState{Query: "Write a note", Agents: []AskAgent{{ID: "writer", Name: "Writer"}, {ID: "coder", Name: "Coder"}}})
	if err != nil || id != "writer" {
		t.Fatalf("agent=%q err=%v", id, err)
	}
}

func TestDeepSeekDecisionRejectsInvalidResponses(t *testing.T) {
	cases := []struct {
		name, content, finish string
		status                int
	}{
		{"http error", "secret-echo", "stop", 401},
		{"text", "not JSON", "stop", 200},
		{"missing answers", `{}`, "stop", 200},
		{"unknown agent", `{"answers":{"agent":{"type":"choice","choice":"outsider","confidence":1}}}`, "stop", 200},
		{"missing confidence", `{"answers":{"agent":{"type":"choice","choice":"writer"}}}`, "stop", 200},
		{"bad confidence", `{"answers":{"agent":{"type":"choice","choice":"writer","confidence":2}}}`, "stop", 200},
		{"wrong type", `{"answers":{"agent":{"type":"score","choice":"writer","confidence":1}}}`, "stop", 200},
		{"extra question", `{"answers":{"agent":{"type":"choice","choice":"writer","confidence":1},"extra":{"type":"choice","choice":"writer","confidence":1}}}`, "stop", 200},
		{"trailing JSON", `{"answers":{"agent":{"type":"choice","choice":"writer","confidence":1}}} {}`, "stop", 200},
		{"truncated", `{"answers":{"agent":{"type":"choice","choice":"writer","confidence":1}}}`, "length", 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: decisionTransport(func(*http.Request) (*http.Response, error) {
				raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": tc.finish, "message": map[string]string{"content": tc.content}}}})
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
			})}
			_, err := (&DeepSeekEvaluator{APIKey: "secret-echo", HTTPClient: client}).Evaluate(context.Background(), "state", decisionQuestions())
			if err == nil || strings.Contains(err.Error(), "secret-echo") {
				t.Fatalf("unsafe or absent error: %v", err)
			}
		})
	}
}
