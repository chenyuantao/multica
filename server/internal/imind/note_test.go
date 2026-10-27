package imind

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestMarkdownRoundTripPreservesEditableSections(t *testing.T) {
	now := time.Date(2026, 10, 27, 10, 20, 30, 0, time.UTC)
	note, err := New("recording", "产品周会：Q4 写作功能规划", now)
	if err != nil {
		t.Fatal(err)
	}
	note.Tags = []string{"工作"}
	note.Content = "# 产品周会\n\n- 确认内测排期"
	note.Transcript = "<!-- transcript: 00:00.000 -->\n好，我们开始今天的周会。"
	note.Audio = &Audio{DurationMS: 112000, Format: "pcm_s16le", SampleRateHz: 16000}

	raw, err := note.Markdown()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(raw, contentStart) || !strings.Contains(raw, transcriptStart) {
		t.Fatalf("missing section delimiter: %s", raw)
	}
	got, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != note.ID || got.Type != note.Type || got.Title != note.Title ||
		got.Content != note.Content || got.Transcript != note.Transcript ||
		got.Audio == nil || got.Audio.DurationMS != 112000 || len(got.Tags) != 1 || got.Tags[0] != "工作" {
		t.Fatalf("round trip = %#v", got)
	}
}

func TestParseRejectsMissingOrUnknownStructure(t *testing.T) {
	if _, err := Parse("# ordinary markdown"); !errors.Is(err, ErrInvalidNote) {
		t.Fatalf("missing frontmatter error = %v", err)
	}
	note, err := New("note", "标题", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := note.Markdown()
	if err != nil {
		t.Fatal(err)
	}
	raw = strings.Replace(raw, "imind_version: 1", "imind_version: 2", 1)
	if _, err := Parse(raw); !errors.Is(err, ErrInvalidNote) {
		t.Fatalf("version error = %v", err)
	}
}
