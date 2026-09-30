package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestClipDeliveredPromptKeepsARuneBoundary(t *testing.T) {
	// A multibyte rune sitting on the cut must not be split.
	body := strings.Repeat("a", maxDeliveredPromptBytes-1) + "界"
	got, truncated := clipDeliveredPrompt(body)
	if !truncated {
		t.Fatal("prompt over the cap should be marked truncated")
	}
	if !utf8.ValidString(got) {
		t.Fatal("clipped prompt is not valid UTF-8")
	}
	if strings.Contains(got, "界") {
		t.Fatal("the rune past the cap should be dropped, not split")
	}
	if len(got) > maxDeliveredPromptBytes {
		t.Fatalf("clipped len = %d, cap = %d", len(got), maxDeliveredPromptBytes)
	}
}

func TestClaimDispatchTextOmitsCredentials(t *testing.T) {
	text, truncated := claimDispatchText(AgentTaskResponse{
		ID:                    "task",
		AuthToken:             "mat_secret",
		RemoteMCPDaemonToken:  "rmcp_secret",
		TriggerCommentContent: "please look",
		Agent: &TaskAgentData{
			ID:            "agent",
			Name:          "Ada",
			Instructions:  "be brief",
			CustomEnv:     map[string]string{"OPENAI_API_KEY": "sk-secret"},
			McpConfig:     json.RawMessage(`{"token":"mcp-secret"}`),
			RuntimeConfig: json.RawMessage(`{"gateway":{"token":"gw-secret","url":"http://local"}}`),
			Skills: []service.AgentSkillData{{
				ID:      "skill",
				Name:    "review",
				Content: "full skill body",
				Files:   []service.AgentSkillFileData{{Path: "a.md", Content: "file body"}},
			}},
		},
	})
	if truncated {
		t.Fatal("small payload should not truncate")
	}
	for _, secret := range []string{"mat_secret", "rmcp_secret", "sk-secret", "mcp-secret", "gw-secret", "full skill body", "file body"} {
		if strings.Contains(text, secret) {
			t.Fatalf("dispatch text contains %q", secret)
		}
	}
	for _, keep := range []string{"please look", "be brief", "review", "http://local", "***"} {
		if !strings.Contains(text, keep) {
			t.Fatalf("dispatch text missing %q\n%s", keep, text)
		}
	}
}

func TestRecordDispatchedTaskKeepsTheLatestClaim(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	taskID := seedBatchTask(t, "delivered-prompt")
	id := parseUUID(taskID)
	testHandler.recordDispatchedTask(context.Background(), id, AgentTaskResponse{TriggerCommentContent: "first"})
	testHandler.recordDispatchedTask(context.Background(), id, AgentTaskResponse{TriggerCommentContent: "second"})

	req := testutil.JSONRequest(http.MethodGet, "/api/tasks/"+taskID+"/delivered-prompt", nil)
	req = testutil.WithURLParams(req, "taskId", taskID)
	ctx := middleware.SetMemberContext(req.Context(), testWorkspaceID, db.Member{})
	var out deliveredPromptResponse
	testutil.Call(t, testHandler.GetDeliveredPrompt, req.WithContext(ctx)).Want(http.StatusOK).JSON(&out)
	if !strings.Contains(out.Prompt, "second") || strings.Contains(out.Prompt, "first") || out.Truncated {
		t.Fatalf("response = %+v", out)
	}
}
