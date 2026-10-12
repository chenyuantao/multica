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
	} {
		if !strings.Contains(out, want) {
			t.Errorf("group chat brief missing %q", want)
		}
	}
}
