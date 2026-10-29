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
	got, err := Parse(raw, note.Title)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != note.ID || got.Type != note.Type || got.Title != note.Title ||
		got.Content != note.Content || got.Transcript != note.Transcript ||
		got.Audio == nil || got.Audio.DurationMS != 112000 || len(got.Tags) != 1 || got.Tags[0] != "工作" {
		t.Fatalf("round trip = %#v", got)
	}
}

func TestMarkdownRejectsInvalidFields(t *testing.T) {
	cases := map[string]func(*Note){
		"invalid type":      func(n *Note) { n.Type = "other" },
		"noncanonical id":   func(n *Note) { n.ID = strings.ReplaceAll(n.ID, "-", "") },
		"non-v4 id":         func(n *Note) { n.ID = "00000000-0000-0000-0000-000000000000" },
		"note transcript":   func(n *Note) { n.Type = "note"; n.Transcript = "text" },
		"clip transcript":   func(n *Note) { n.Type = "clip"; n.Transcript = "text" },
		"note audio":        func(n *Note) { n.Type = "note"; n.Audio = &Audio{Format: "pcm_s16le", SampleRateHz: 16000} },
		"negative duration": func(n *Note) { n.Audio = &Audio{DurationMS: -1, Format: "pcm_s16le", SampleRateHz: 16000} },
		"audio format":      func(n *Note) { n.Audio = &Audio{Format: "mp3", SampleRateHz: 16000} },
		"audio sample rate": func(n *Note) { n.Audio = &Audio{Format: "pcm_s16le", SampleRateHz: 44100} },
		"unsafe source":     func(n *Note) { s := "javascript:alert(1)"; n.SourceURL = &s },
		"nul content":       func(n *Note) { n.Content = "a\x00b" },
		"invalid utf8":      func(n *Note) { n.Content = string([]byte{0xff}) },
		"oversize":          func(n *Note) { n.Content = strings.Repeat("a", 4<<20) },
	}
	for _, marker := range []string{contentStart, contentEnd, transcriptStart, transcriptEnd} {
		cases["content "+marker] = func(n *Note) { n.Content = marker }
		cases["transcript "+marker] = func(n *Note) { n.Transcript = marker }
		cases["title "+marker] = func(n *Note) { n.Title = marker }
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			note, err := New("recording", "标题", time.Now())
			if err != nil {
				t.Fatal(err)
			}
			mutate(&note)
			if _, err := note.Markdown(); !errors.Is(err, ErrInvalidNote) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestParseRejectsAmbiguousBoundariesAndFields(t *testing.T) {
	note, _ := New("recording", "标题", time.Now())
	raw, _ := note.Markdown()
	cases := map[string]string{
		"duplicate start":    strings.Replace(raw, contentStart, contentStart+"\n"+contentStart, 1),
		"duplicate end":      raw + transcriptEnd,
		"outside prefix":     strings.Replace(raw, contentStart, "lost text\n"+contentStart, 1),
		"outside middle":     strings.Replace(raw, transcriptStart, "lost text\n"+transcriptStart, 1),
		"outside suffix":     raw + "lost text",
		"crossed sections":   strings.Replace(raw, contentEnd+"\n\n"+transcriptStart, transcriptStart+"\n"+contentEnd, 1),
		"inline marker":      strings.Replace(raw, contentStart+"\n", contentStart+"inline\n", 1),
		"unknown header":     strings.Replace(raw, "imind_version: 1", "imind_version: 1\npath: ../other.md", 1),
		"multiple yaml docs": strings.Replace(raw, "imind_version: 1", "imind_version: 1\n...\n---\npath: other", 1),
		"legacy title":       strings.Replace(raw, "imind_version: 1", "imind_version: 1\ntitle: 标题", 1),
		"scalar tag":         strings.Replace(raw, "tags: []", "tags: [42]", 1),
		"oversize":           raw + strings.Repeat(" ", 4<<20),
		"invalid utf8":       strings.Replace(raw, contentStart+"\n", contentStart+"\n"+string([]byte{0xff}), 1),
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse(input, note.Title); !errors.Is(err, ErrInvalidNote) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestParseRejectsMissingOrUnknownStructure(t *testing.T) {
	if _, err := Parse("# ordinary markdown", "标题"); !errors.Is(err, ErrInvalidNote) {
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
	if _, err := Parse(raw, note.Title); !errors.Is(err, ErrInvalidNote) {
		t.Fatalf("version error = %v", err)
	}
}

func TestGeneratedSummaryAndClipMetadataRoundTrip(t *testing.T) {
	note, err := New("clip", "生成中的剪藏", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	note.Summary = "网页摘要"
	note.Clip = &ClipMetadata{OriginalText: "原始链接 https://example.com", Prompt: "总结观点"}
	raw, err := note.Markdown()
	if err != nil {
		t.Fatal(err)
	}
	got, err := Parse(raw, "生成中的剪藏")
	if err != nil {
		t.Fatal(err)
	}
	if got.Summary != note.Summary || got.Clip == nil || *got.Clip != *note.Clip {
		t.Fatalf("metadata lost: %+v", got)
	}
	note.Type = "note"
	if _, err := note.Markdown(); err == nil {
		t.Fatal("accepted clip metadata on ordinary note")
	}
}
