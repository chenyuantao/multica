package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
	"io"
	"net/http"
	"strings"
	"testing"
)

type imindNamingTransport func(*http.Request) (*http.Response, error)

func (f imindNamingTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestIMindNamingProviderContract(t *testing.T) {
	client := &http.Client{Transport: imindNamingTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.deepseek.com/chat/completions" || r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Fatalf("unexpected provider request")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "deepseek-flash" || body["thinking"].(map[string]any)["type"] != "disabled" || body["reasoning"].(map[string]any)["effort"] != "low" {
			t.Fatalf("unexpected mode: %v", body)
		}
		messages := body["messages"].([]any)
		if !strings.Contains(messages[1].(map[string]any)["content"].(string), "saved transcript") {
			t.Fatal("saved content missing")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"title\":\"项目周会\",\"summary\":\"讨论发布计划\"}"}}]}`))}, nil
	})}
	got, err := generateIMindName(context.Background(), client, "test-secret", "saved content\nsaved transcript")
	if err != nil || got.Title != "项目周会" || got.Summary != "讨论发布计划" {
		t.Fatalf("result=%+v err=%v", got, err)
	}
}

func TestIMindNamingRejectsProviderFailures(t *testing.T) {
	for _, body := range []string{`{}`, `{"choices":[]}`, `{"choices":[{"message":{"content":"not json"}}]}`, `{"choices":[{"message":{"content":"{\"title\":\"../bad\",\"summary\":\"summary\"}"}}]}`, `{"choices":[{"message":{"content":"{\"title\":\"title\",\"summary\":\"\"}"}}]}`} {
		t.Run(body, func(t *testing.T) {
			client := &http.Client{Transport: imindNamingTransport(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			if _, err := generateIMindName(context.Background(), client, "key", "body"); err == nil {
				t.Fatal("accepted malformed provider response")
			}
		})
	}
}

func TestIMindNamingPersistsSavedRevisionAndProtectsKey(t *testing.T) {
	h := *testHandler
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{DaemonID: "naming-test", Machine: "imind-naming", OwnerUserID: testUserID, WorkspaceID: testWorkspaceID, Visibility: fileshare.VisibilityWorkspace, Enabled: true, IMindScopeRevision: true, IMindRename: true, IMindMedia: true}, t.TempDir())
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h.FileShares = hub
	box, err := secretbox.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	h.IMindSecretBox = box
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `UPDATE workspace SET imind_deepseek_key=NULL,imind_clip_agent_id=NULL WHERE id=$1`, testWorkspaceID)
	})
	member := groupChatWorkspaceMember(t, "naming member", "imind-naming-member@multica.test")
	request := func(user, method, url string, body any) *http.Request {
		return groupChatRequestAs(t, user, method, url, body)
	}
	testutil.Call(t, h.PutIMindDeepSeek, request(member, "PUT", "/api/imind/settings/deepseek", map[string]any{"api_key": "test-secret"})).Want(403)
	testutil.Call(t, h.PutIMindDeepSeek, request(testUserID, "PUT", "/api/imind/settings/deepseek", map[string]any{"api_key": "test-secret"})).Want(200)
	var sealed []byte
	if err := testPool.QueryRow(t.Context(), `SELECT imind_deepseek_key FROM workspace WHERE id=$1`, testWorkspaceID).Scan(&sealed); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("test-secret")) {
		t.Fatal("API key stored in plaintext")
	}
	var config map[string]any
	testutil.Call(t, h.GetIMindDeepSeek, request(member, "GET", "/api/imind/settings/deepseek", nil)).Want(200).JSON(&config)
	if len(config) != 1 || config["configured"] != true {
		t.Fatalf("unexpected config fields: %v", config)
	}
	var note iMindNoteResponse
	testutil.Call(t, h.PostIMindNotes, request(testUserID, "POST", "/api/imind/notes", map[string]any{"share_machine": "imind-naming", "type": "recording", "title": "旧标题", "transcript": "saved transcript", "content": "saved content", "tags": []string{"原有"}})).Want(201).JSON(&note)
	originalRevision := note.Revision
	h.IMindNamingHTTP = &http.Client{Transport: imindNamingTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"title\":\"新标题\",\"summary\":\"摘要\"}"}}]}`))}, nil
	})}
	name := func(revision string) *http.Request {
		return withURLParam(request(testUserID, "POST", "/api/imind/notes/"+note.ID+"/ai-name", map[string]string{"share_machine": "imind-naming", "revision": revision}), "id", note.ID)
	}
	testutil.Call(t, h.PostIMindAIName, name(note.Revision)).Want(200).JSON(&note)
	if note.Title != "新标题" || note.Summary != "摘要" || note.Transcript != "saved transcript" || note.Content != "saved content" {
		t.Fatalf("unexpected named note: %+v", note)
	}
	testutil.Call(t, h.PostIMindAIName, name(originalRevision)).Want(409)
	originalRevision = note.Revision
	h.IMindNamingHTTP = &http.Client{Transport: imindNamingTransport(func(r *http.Request) (*http.Response, error) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(body["messages"].([]any)[1].(map[string]any)["content"].(string), "saved content") || !strings.Contains(body["messages"].([]any)[1].(map[string]any)["content"].(string), `"原有"`) {
			t.Fatal("saved content missing")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"tags\":[\"原有\",\"工作\",\"计划\"]}"}}]}`))}, nil
	})}
	tag := func(revision string) *http.Request {
		return withURLParam(request(testUserID, "POST", "/tag", map[string]string{"share_machine": "imind-naming", "revision": revision}), "id", note.ID)
	}
	testutil.Call(t, h.PostIMindAITag, tag(note.Revision)).Want(200).JSON(&note)
	if len(note.Tags) != 3 || note.Tags[0] != "原有" || note.Tags[1] != "工作" || note.Tags[2] != "计划" {
		t.Fatalf("unexpected tags: %v", note.Tags)
	}
	testutil.Call(t, h.PostIMindAITag, tag(originalRevision)).Want(409)
	testutil.Call(t, h.PutIMindDeepSeek, request(testUserID, "PUT", "/api/imind/settings/deepseek", map[string]any{"api_key": ""})).Want(200)
	testutil.Call(t, h.PostIMindAIName, name(note.Revision)).Want(503)
	var got iMindNoteResponse
	testutil.Call(t, h.PostIMindNote, request(testUserID, "POST", "/api/imind/notes/get", map[string]string{"share_machine": "imind-naming", "id": note.ID})).Want(200).JSON(&got)
	if got.Title != note.Title || got.Summary != note.Summary {
		t.Fatal("failure changed saved note")
	}
}

func TestIMindTagProviderValidation(t *testing.T) {
	for _, tc := range []struct {
		content string
		valid   bool
	}{
		{`{"tags":["工作","计划"]}`, true},
		{`{"tags":["one"]}`, false},
		{`{"tags":["one","one"]}`, false},
		{`{"tags":["one","#two"]}`, false},
		{`{"tags":"bad"}`, false},
	} {
		t.Run(tc.content, func(t *testing.T) {
			client := &http.Client{Transport: imindNamingTransport(func(r *http.Request) (*http.Response, error) {
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				if payload["model"] != "deepseek-flash" || payload["thinking"].(map[string]any)["type"] != "disabled" {
					t.Fatal(payload)
				}
				body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": tc.content}}}})
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body))}, nil
			})}
			_, err := generateIMindTags(context.Background(), client, "key", "note")
			if (err == nil) != tc.valid {
				t.Fatalf("error: %v", err)
			}
		})
	}
}
