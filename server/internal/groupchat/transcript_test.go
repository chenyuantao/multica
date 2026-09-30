package groupchat

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func turn(id, role, text string) Turn {
	return Turn{ID: id, Author: id, Role: role, Text: text}
}

func excerptIDs(t Transcript) []string {
	ids := make([]string, len(t.Excerpts))
	for i, e := range t.Excerpts {
		ids[i] = e.ID
	}
	return ids
}

func TestSelectTranscriptKeepsEverythingWithinBudget(t *testing.T) {
	turns := []Turn{turn("m1", "member", "hi"), turn("a1", "agent", "hello"), turn("m2", "member", "next")}
	got := SelectTranscript(turns, []string{"m2"}, 24000, 6000)
	if strings.Join(excerptIDs(got), ",") != "m1,a1,m2" || len(got.OmittedAfter) != 0 {
		t.Fatalf("got %+v", got)
	}
	if !got.Excerpts[2].Trigger || got.Excerpts[0].Trigger {
		t.Fatalf("trigger flags wrong: %+v", got.Excerpts)
	}
	if out := got.Render("issue-1"); strings.Contains(out, "multica issue comment list") {
		t.Fatalf("a complete transcript should not carry read commands:\n%s", out)
	}
}

func TestSelectTranscriptPrefersLatestRequestAndTriggersOverRecent(t *testing.T) {
	long := strings.Repeat("x", 900)
	turns := []Turn{
		turn("old-trigger", "agent", "please review "+long),
		turn("filler1", "agent", long),
		turn("request", "member", "what now? "+long),
		turn("filler2", "agent", long),
		turn("filler3", "agent", long),
	}
	// Room for about three messages: the latest request and the trigger must
	// survive even though newer agent messages exist.
	got := SelectTranscript(turns, []string{"old-trigger"}, 2900, 6000)
	ids := strings.Join(excerptIDs(got), ",")
	if ids != "old-trigger,request,filler3" {
		t.Fatalf("got %s", ids)
	}
	if len(got.Excerpts[1].OmittedBefore) != 1 || got.Excerpts[1].OmittedBefore[0].ID != "filler1" ||
		len(got.Excerpts[2].OmittedBefore) != 1 || got.Excerpts[2].OmittedBefore[0].ID != "filler2" {
		t.Fatalf("gaps not recorded: %+v", got.Excerpts)
	}
}

func TestSelectTranscriptCapsOneMessage(t *testing.T) {
	turns := []Turn{turn("m1", "member", "earlier question"), turn("a1", "agent", strings.Repeat("长", 10000))}
	got := SelectTranscript(turns, nil, 24000, 6000)
	if len(got.Excerpts) != 2 {
		t.Fatalf("a long reply pushed out the rest: %+v", excerptIDs(got))
	}
	e := got.Excerpts[1]
	if !e.Truncated || utf8.RuneCountInString(e.Text) != 6000 {
		t.Fatalf("got truncated=%v runes=%d", e.Truncated, utf8.RuneCountInString(e.Text))
	}
}

func TestSelectTranscriptReportsNewerOmissions(t *testing.T) {
	turns := []Turn{
		turn("request", "member", strings.Repeat("q", 950)),
		turn("a1", "agent", strings.Repeat("a", 950)),
	}
	got := SelectTranscript(turns, nil, 1000, 6000)
	if strings.Join(excerptIDs(got), ",") != "request" || len(got.OmittedAfter) != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestTranscriptRender(t *testing.T) {
	turns := []Turn{
		{ID: "s1", Author: "Ops", Role: "agent", Text: strings.Repeat("s", 500), Time: "2026-09-30T02:10:00Z"},
		{ID: "s2", Author: "Ops", Role: "agent", Text: strings.Repeat("s", 500), Time: "2026-09-30T02:14:00Z"},
		{ID: "m1", Author: "Ada", Role: "member", Text: " ship it ", Time: "2026-09-30T02:15:00Z"},
		{ID: "a1", Author: "Ops", Role: "agent", Text: strings.Repeat("o", 400), Time: "2026-09-30T02:16:00Z"},
	}
	got := SelectTranscript(turns, []string{"m1"}, 280, 6000).Render("issue-1")
	want := "Messages marked [truncated id=<id>] are cut short. Read one in full with `multica issue comment list issue-1 --thread <id> --tail 0 --output json`.\n" +
		"Omitted ranges list their time span. Read the messages after a time with `multica issue comment list issue-1 --since <time> --output json`.\n\n" +
		"[2 message(s) omitted, 2026-09-30T02:10:00Z – 2026-09-30T02:14:00Z, ids: s1, s2]\n\n" +
		"Ada (member, triggered this reply): ship it\n\n" +
		"Ops (agent): " + strings.Repeat("o", 240) + " …[truncated id=a1]"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestTranscriptRenderCapsOmittedIDs(t *testing.T) {
	var turns []Turn
	for i := range 8 {
		turns = append(turns, turn(string(rune('a'+i)), "agent", strings.Repeat("z", 500)))
	}
	turns = append(turns, turn("m1", "member", "hi"))
	got := SelectTranscript(turns, nil, 100, 6000).Render("issue-1")
	if !strings.Contains(got, "[8 message(s) omitted, ids: a, b, c, d, e +3 more]") {
		t.Fatalf("got %q", got)
	}
}
