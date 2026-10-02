package groupchat

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func excerptToken(t *testing.T, excerpt docExcerpt) string {
	t.Helper()
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(excerpt); err != nil {
		t.Fatal(err)
	}
	payload := base64.RawURLEncoding.EncodeToString(bytes.TrimRight(buf.Bytes(), "\n"))
	label := strings.Join(strings.Fields(excerpt.Text), " ")
	if label == "" {
		label = "…"
	}
	return "[" + label + "](doc-excerpt://" + payload + ")"
}

func TestClientExcerptPayloadDecodes(t *testing.T) {
	// encodeDocExcerpt({ name: "本周周报", path: "notes/weekly.md", text: "周五发布" })
	const payload = "eyJuYW1lIjoi5pys5ZGo5ZGo5oqlIiwicGF0aCI6Im5vdGVzL3dlZWtseS5tZCIsInRleHQiOiLlkajkupTlj5HluIMifQ"
	got, ok := decodeExcerptPayload(payload)
	if !ok || got != (docExcerpt{Name: "本周周报", Path: "notes/weekly.md", Text: "周五发布"}) {
		t.Fatalf("%+v ok=%v", got, ok)
	}
	if excerptToken(t, got) != "[周五发布](doc-excerpt://"+payload+")" {
		t.Fatalf("encoder drifted from the client: %s", excerptToken(t, got))
	}
}

func TestReadableExcerptsAndRenderKeepThePassage(t *testing.T) {
	weekly := docExcerpt{Name: "本周周报", Path: "notes/weekly.md", Text: "周五发布"}
	plan := docExcerpt{Name: `计划 "v2"`, Path: "notes/plan.md", Text: "a < b & c"}
	text := "请改 " + excerptToken(t, weekly) + " 和 " + excerptToken(t, plan)
	if got := readableExcerpts(text); got != "请改 「周五发布」（本周周报 notes/weekly.md） 和 「a < b & c」（计划 \"v2\" notes/plan.md）" {
		t.Fatalf("readable: %s", got)
	}
	var b strings.Builder
	writeMessageText(&b, text)
	got := b.String()
	want := `请改 <ref role="excerpt" path="notes/weekly.md" name="本周周报">周五发布</ref> 和 <ref role="excerpt" path="notes/plan.md" name="计划 &quot;v2&quot;">a &lt; b &amp; c</ref>`
	if got != want {
		t.Fatalf("got %s\nwant %s", got, want)
	}
	if strings.Contains(got, "doc-excerpt://") {
		t.Fatalf("payload leaked into the transcript: %s", got)
	}
}

func TestClipMessageDoesNotSplitAPassage(t *testing.T) {
	token := excerptToken(t, docExcerpt{Name: "笔记", Path: "a.md", Text: strings.Repeat("段", 50)})
	text := strings.Repeat("前", 180) + token + "后记"
	got, truncated := clipMessage(text, 200)
	if !truncated {
		t.Fatal("expected the tail to be cut")
	}
	if strings.Contains(got, "doc-excerpt://") || strings.Contains(got, "[[") {
		t.Fatalf("cut through a passage: %s", got)
	}
	if got != strings.Repeat("前", 180) {
		t.Fatalf("got %q", got)
	}

	whole, cut := clipMessage(token+"后记", 10)
	if whole != token || !cut {
		t.Fatalf("a leading passage should stay whole, got cut=%v %q", cut, whole)
	}
}

func TestTranscriptRenderEmbedsSelectedPassages(t *testing.T) {
	token := excerptToken(t, docExcerpt{Name: "本周周报", Path: "notes/weekly.md", Text: "周五发布"})
	turns := []Turn{{
		ID: "m1", Author: "Ada", Role: "member", Text: "请改 " + token + " 这里", Time: "2026-09-30T02:17:00Z",
	}}
	got := SelectTranscript(turns, []string{"m1"}, 24000, 250).Render("issue-1", "")
	want := `<msg index="0" id="m1" time="2026-09-30T02:17:00Z" sender="Ada" role="member" trigger="true">请改 <ref role="excerpt" path="notes/weekly.md" name="本周周报">周五发布</ref> 这里</msg>`
	if !strings.Contains(got, want) {
		t.Fatalf("got %s", got)
	}
	if !strings.Contains(got, `role="excerpt" is a passage the sender selected`) {
		t.Fatalf("excerpt is not explained:\n%s", got)
	}
}
