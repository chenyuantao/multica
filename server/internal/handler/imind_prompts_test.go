package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
)

func TestIMindPromptSettings(t *testing.T) {
	h := testHandler
	dbfx.Exec(t, `UPDATE workspace SET imind_prompt_templates='{}' WHERE id=$1`, testWorkspaceID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `UPDATE workspace SET imind_prompt_templates='{}' WHERE id=$1`, testWorkspaceID)
	})
	member := groupChatWorkspaceMember(t, "prompt member", "imind-prompt-member@multica.test")
	get := func(user string) []imindPromptResponse {
		t.Helper()
		var out struct {
			Prompts   []imindPromptResponse `json:"prompts"`
			Variables []string              `json:"variables"`
		}
		testutil.Call(t, h.GetIMindPrompts, groupChatRequestAs(t, user, http.MethodGet, "/api/imind/settings/prompts", nil)).Want(200).JSON(&out)
		if len(out.Prompts) != 4 || len(out.Variables) != len(imind.PromptVariables) {
			t.Fatalf("missing prompt contract: %+v", out)
		}
		return out.Prompts
	}
	put := func(user string, body map[string]any, status int) {
		t.Helper()
		testutil.Call(t, h.PutIMindPrompt, groupChatRequestAs(t, user, http.MethodPut, "/api/imind/settings/prompts", body)).Want(status)
	}
	for _, prompt := range get(member) {
		if prompt.Custom || prompt.Template != prompt.Default || prompt.Template != imind.DefaultPrompts[prompt.Kind] {
			t.Fatalf("incorrect default: %+v", prompt)
		}
	}
	put(member, map[string]any{"kind": "processor", "template": "Denied"}, 403)
	for _, kind := range imind.PromptKinds {
		custom := "Custom " + kind + " {{FILE_PATH}} {{FILE_CONTENT}}"
		put(testUserID, map[string]any{"kind": kind, "template": custom}, 200)
		got, err := h.renderIMindPrompt(t.Context(), parseUUID(testWorkspaceID), kind, map[string]string{"FILE_PATH": "host/iMind/file.md", "FILE_CONTENT": "---\nid: file\n---\n{{FILE_PATH}}"})
		if err != nil || got != "Custom "+kind+" host/iMind/file.md ---\nid: file\n---\n{{FILE_PATH}}" {
			t.Fatalf("rendered=%q err=%v", got, err)
		}
	}
	for _, prompt := range get(member) {
		if !prompt.Custom || !strings.HasPrefix(prompt.Template, "Custom "+prompt.Kind) {
			t.Fatalf("override not persisted: %+v", prompt)
		}
	}
	for _, body := range []map[string]any{{"kind": "bad", "template": "text"}, {"kind": "processor"}, {"kind": "processor", "template": ""}, {"kind": "processor", "template": "{{TYPO}}"}, {"kind": "processor", "template": 42}} {
		put(testUserID, body, 400)
	}
	put(testUserID, map[string]any{"kind": "processor", "template": nil}, 200)
	for _, prompt := range get(member) {
		if prompt.Kind == "processor" {
			if prompt.Custom || prompt.Template != prompt.Default {
				t.Fatal("reset did not restore default")
			}
		} else if !prompt.Custom {
			t.Fatal("reset changed another template")
		}
	}
}

func TestIMindPromptOverridesReachNamingAndAgentContext(t *testing.T) {
	h := *testHandler
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{DaemonID: "prompt-device", Machine: "prompt-host", OwnerUserID: testUserID, WorkspaceID: testWorkspaceID, Visibility: fileshare.VisibilityWorkspace, Enabled: true, IMindScopeRevision: true, IMindRename: true, IMindMedia: true}, t.TempDir())
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
		testPool.Exec(context.Background(), `UPDATE workspace SET imind_prompt_templates='{}',imind_deepseek_key=NULL WHERE id=$1`, testWorkspaceID)
	})
	request := func(method, url string, body any) *http.Request {
		return groupChatRequestAs(t, testUserID, method, url, body)
	}
	testutil.Call(t, h.PutIMindDeepSeek, request("PUT", "/settings", map[string]string{"api_key": "test-key"})).Want(200)
	for _, kind := range imind.PromptKinds {
		testutil.Call(t, h.PutIMindPrompt, request("PUT", "/prompts", map[string]string{"kind": kind, "template": kind + "|{{FILE_PATH}}|{{FILE_RELATIVE_PATH}}|{{FILE_CONTENT}}|{{TRANSCRIPT}}|{{CLIP_INSTRUCTIONS}}"})).Want(200)
	}
	for _, noteType := range []string{"note", "recording", "clip"} {
		t.Run(noteType, func(t *testing.T) {
			var note iMindNoteResponse
			body := map[string]any{"share_machine": "prompt-host", "type": noteType, "title": "Original " + noteType, "content": "body {{FILE_PATH}}", "transcript": "", "tags": []string{"已有标签"}}
			if noteType == "recording" {
				body["transcript"] = "spoken"
			}
			if noteType == "clip" {
				body["source_url"] = "https://example.test/article"
				body["clip"] = map[string]string{"original_text": "article", "prompt": "keep examples"}
				body["transcript"] = ""
			}
			testutil.Call(t, h.PostIMindNotes, request("POST", "/notes", body)).Want(201).JSON(&note)
			var chat struct {
				IssueID string `json:"issue_id"`
			}
			testutil.Call(t, h.EnsureIMindChat, request("POST", "/ensure", map[string]string{"share_machine": "prompt-host", "note_id": note.ID, "revision": note.Revision})).Want(200).JSON(&chat)
			dbfx.Cleanup(t, `DELETE FROM imind_group_chat WHERE issue_id=$1`, chat.IssueID)
			issue, err := h.Queries.GetIssue(t.Context(), parseUUID(chat.IssueID))
			if err != nil {
				t.Fatal(err)
			}
			kind := "processor"
			if noteType == "clip" {
				kind = "clip"
			}
			turn, ok := h.iMindNoteContext(t.Context(), issue)
			if !ok || !strings.HasPrefix(turn.Text, kind+"|prompt-host/iMind/Original "+noteType+".md|iMind/Original "+noteType+".md|") || !strings.Contains(turn.Text, "imind_version:") || !strings.Contains(turn.Text, "body {{FILE_PATH}}") || !strings.Contains(turn.Text, `Existing tags (JSON): ["已有标签"]`) {
				t.Fatalf("configured agent context missing: %+v", turn)
			}
			if noteType == "clip" {
				if !strings.Contains(turn.Text, "|keep examples\nExisting tags (JSON):") {
					t.Fatal(turn.Text)
				}
				return
			}
			kind = "file_title"
			if noteType == "recording" {
				kind = "recording_title"
			}
			h.IMindNamingHTTP = &http.Client{Transport: imindNamingTransport(func(r *http.Request) (*http.Response, error) {
				var payload struct {
					Messages []struct {
						Content string `json:"content"`
					} `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				text := payload.Messages[1].Content
				if !strings.HasPrefix(text, kind+"|prompt-host/iMind/Original "+noteType+".md|") || !strings.Contains(text, "imind_version:") || !strings.Contains(text, "body {{FILE_PATH}}") || !strings.HasSuffix(text, "|"+note.Transcript+"|") {
					t.Fatalf("configured naming prompt missing: %s", text)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"title\":\"Named ` + noteType + `\",\"summary\":\"Summary\"}"}}]}`))}, nil
			})}
			testutil.Call(t, h.PostIMindAIName, withURLParam(request("POST", "/name", map[string]string{"share_machine": "prompt-host", "revision": note.Revision}), "id", note.ID)).Want(200)
		})
	}
}
