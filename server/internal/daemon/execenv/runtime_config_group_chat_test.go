package execenv

import (
	"strings"
	"testing"
)

func TestGroupChatBriefOmitsDelegation(t *testing.T) {
	t.Parallel()
	out := buildMetaSkillContent("claude", TaskContextForEnv{
		IssueID:   "11111111-2222-3333-4444-555555555555",
		GroupChat: true,
		AgentSkills: []SkillContextForEnv{{
			Name: "multica-platform",
		}},
	})
	for _, banned := range []string{
		"## Sub-issue Creation",
		"enqueues a new run for that agent",
		"If your role is delegation-only",
		"Before assigning work",
		"you dispatched sub-issues",
		"hand another agent a concrete new sub-task",
		"Post your final results as a comment",
		"Final results MUST be delivered via",
		"Post exactly ONE comment per run",
		"set `in_progress` FIRST",
	} {
		if strings.Contains(out, banned) {
			t.Errorf("group chat brief still contains %q", banned)
		}
	}
	for _, want := range []string{
		"## Mentions",
		"does not start a run",
		"Do not create a sub-issue or assign another agent",
		"Do not use that skill to create a sub-issue",
		"The platform automatically saves that final reply as a new group message",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("group chat brief missing %q", want)
		}
	}
}

func TestGroupChatReplyUsesAutomaticDelivery(t *testing.T) {
	t.Parallel()
	for _, leader := range []bool{false, true} {
		out := BuildGroupChatReplyInstructions("chat-id", leader)
		if !strings.Contains(out, "Return your final reply directly") || !strings.Contains(out, "automatically saves it as a new group message") {
			t.Fatalf("missing automatic delivery instructions: %s", out)
		}
		for _, banned := range []string{"--content-file", "reply.md", "--parent", "multica issue comment add chat-id"} {
			if strings.Contains(out, banned) {
				t.Errorf("reply instructions still contain %q: %s", banned, out)
			}
		}
	}
}
