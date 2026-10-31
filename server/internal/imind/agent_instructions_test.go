package imind

import (
	"strings"
	"testing"
)

func TestAgentInstructionsExampleParses(t *testing.T) {
	_, example, ok := strings.Cut(AgentInstructions, "```markdown\n")
	if !ok {
		t.Fatal("missing Markdown example")
	}
	example, _, ok = strings.Cut(example, "\n```")
	if !ok {
		t.Fatal("unterminated Markdown example")
	}
	note, err := Parse(example+"\n", "示例")
	if err != nil {
		t.Fatalf("guide example no longer matches the note contract: %v", err)
	}
	if note.Type != "note" || note.Content == "" || note.Transcript != "" {
		t.Fatalf("unexpected example: %+v", note)
	}
}
