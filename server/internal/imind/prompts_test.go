package imind

import (
	"strings"
	"testing"
)

func TestIMindPromptTemplates(t *testing.T) {
	for _, kind := range PromptKinds {
		if err := ValidatePrompt(kind, DefaultPrompts[kind]); err != nil {
			t.Fatalf("default %s: %v", kind, err)
		}
	}
	for _, template := range []string{"", "  \n", "{{MISSING}}", "{{FILE_PATH }}", strings.Repeat("x", MaxPromptBytes+1)} {
		if ValidatePrompt("processor", template) == nil {
			t.Fatalf("accepted invalid template %q", template)
		}
	}
	if ValidatePrompt("unknown", "text") == nil {
		t.Fatal("accepted unknown kind")
	}
	// Plain text is a valid override, even without variables.
	if err := ValidatePrompt("processor", "Always answer in Chinese."); err != nil {
		t.Fatal(err)
	}
	source := "---\nid: saved-id\n---\n中文 {{FILE_PATH}} $1 \\ text"
	url := "https://example.test/article"
	note := Note{ID: "saved-id", Type: "clip", Title: "笔记", Content: "body", Transcript: "spoken", SourceURL: &url, Clip: &ClipMetadata{OriginalText: "pasted", Prompt: "keep details"}}
	values := PromptValues(note, source, "mac", "iMind/笔记.md", "rev")
	expected := map[string]string{"FILE_CONTENT": source, "FILE_PATH": "mac/iMind/笔记.md", "FILE_RELATIVE_PATH": "iMind/笔记.md", "SHARE_MACHINE": "mac", "FILE_TITLE": "笔记", "FILE_TYPE": "clip", "FILE_ID": "saved-id", "FILE_REVISION": "rev", "FILE_BODY": "body", "TRANSCRIPT": "spoken", "SOURCE_URL": url, "CLIP_ORIGINAL_TEXT": "pasted", "CLIP_INSTRUCTIONS": "keep details"}
	for name, want := range expected {
		if got, err := RenderPrompt("{{"+name+"}}", values); err != nil || got != want {
			t.Fatalf("%s = %q, want %q", name, got, want)
		}
	}
	if got, err := RenderPrompt("{{FILE_CONTENT}} {{FILE_CONTENT}}", values); err != nil || got != source+" "+source {
		t.Fatal("recursive replacement or changed source content")
	}
	legacy := PromptValues(Note{Type: "clip", Content: "saved placeholder"}, "md", "mac", "iMind/old.md", "rev")
	if got, err := RenderPrompt(DefaultPrompts["clip"], legacy); err != nil || !strings.Contains(got, "saved placeholder") {
		t.Fatal("clip without metadata lost recoverable content")
	}
	if values := PromptValues(Note{}, "", "mac", "file.md", ""); values["SOURCE_URL"] != "" || values["CLIP_INSTRUCTIONS"] != "" {
		t.Fatal("absent values must be empty")
	}
}

func TestIMindPromptExpansionLimit(t *testing.T) {
	values := map[string]string{"FILE_CONTENT": strings.Repeat("x", MaxRenderedPromptBytes/2+1)}
	if _, err := RenderPrompt("{{FILE_CONTENT}}{{FILE_CONTENT}}", values); err == nil {
		t.Fatal("accepted oversized expanded prompt")
	}
}
