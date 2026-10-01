package groupchat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/pkg/typesafe"
)

func person(id, author, text string) Turn {
	return Turn{ID: id, Author: author, AuthorID: author, Role: "member", Text: text}
}

func speaker(id, author, text string) Turn {
	return Turn{ID: id, Author: author, AuthorID: author, Role: "agent", Text: text}
}

func TestProtectedBurstKeepsTheCheckAndTheSamePersonsRun(t *testing.T) {
	turns := []Turn{
		person("old", "u1", "earlier"),
		speaker("ack", "a1", "ack"),
		person("also", "u1", "and the logs"),
		person("check", "u1", "please check"),
	}
	got := ProtectedBurst(turns, []string{"check"})
	if !got["check"] || !got["also"] || got["old"] || got["ack"] || len(got) != 2 {
		t.Fatalf("protected %+v", got)
	}
}

func TestProtectedBurstStopsAtAnotherPerson(t *testing.T) {
	turns := []Turn{
		person("a", "u1", "from ada"),
		person("b", "u2", "please check"),
	}
	got := ProtectedBurst(turns, []string{"b"})
	if !got["b"] || got["a"] || len(got) != 1 {
		t.Fatalf("protected %+v", got)
	}
}

func TestProtectedBurstUsesTheLatestMemberWhenNothingTriggered(t *testing.T) {
	turns := []Turn{
		person("a", "u1", "one"),
		person("b", "u1", "two"),
		speaker("ack", "a1", "later"),
	}
	got := ProtectedBurst(turns, nil)
	if !got["a"] || !got["b"] || got["ack"] {
		t.Fatalf("protected %+v", got)
	}
}

func TestProtectedBurstIgnoresAnAgentTrigger(t *testing.T) {
	turns := []Turn{
		person("note", "u1", "context"),
		speaker("check", "a1", "I will look"),
	}
	got := ProtectedBurst(turns, []string{"check"})
	if !got["note"] || got["check"] {
		t.Fatalf("protected %+v", got)
	}
}

func TestRequiredVisibleKeepsAttachmentsOutsideTheBurst(t *testing.T) {
	turns := []Turn{
		{ID: "file", AuthorID: "u1", Role: "member", Text: "shot.png", Attachment: true},
		speaker("ack", "a1", "ack"),
		person("check", "u1", "please check"),
	}
	got := RequiredVisible(turns, []string{"check"})
	if !got["file"] || !got["check"] || got["ack"] {
		t.Fatalf("visible %+v", got)
	}
}

func TestFilterForAgentSkipsAttachmentMessages(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{
		"m0": {Choice: "屏蔽"},
		"m1": {Choice: "屏蔽"},
	}}
	excerpts := []Excerpt{
		{Turn: Turn{ID: "file", Author: "Ada", Role: "member", Text: "shot.png", Attachment: true}, Index: 0},
		{Turn: Turn{ID: "old", Author: "Ada", Role: "member", Text: "old topic"}, Index: 1},
	}
	hidden, err := FilterForAgent(context.Background(), ev, Card{Name: "Ops"}, excerpts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !hidden["old"] || hidden["file"] {
		t.Fatalf("hidden %+v", hidden)
	}
	if _, ok := ev.questions["m0"]; ok {
		t.Fatal("an attachment message was submitted to jev")
	}
	transcript := Transcript{Excerpts: excerpts}
	HideMessages(&transcript, map[string]bool{"file": true, "old": true})
	if transcript.Excerpts[0].Text != "shot.png" || transcript.Excerpts[0].Hidden {
		t.Fatalf("attachment was hidden: %+v", transcript.Excerpts[0])
	}
}

func TestFilterForAgentHidesOnlyWhatJevShields(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{
		"m0": {Choice: "屏蔽"},
		"m1": {Choice: "保留"},
		"m2": {Choice: "屏蔽"},
	}}
	excerpts := []Excerpt{
		{Turn: Turn{ID: "old", Author: "Ada", Role: "member", Text: "old topic"}, Index: 0},
		{Turn: Turn{ID: "note", Author: "Ops", Role: "agent", Text: "ack"}, Index: 1},
		{Turn: Turn{ID: "check", Author: "Ada", Role: "member", Text: "please check"}, Index: 2},
	}
	hidden, err := FilterForAgent(context.Background(), ev, Card{ID: "a3", Name: "Ops", Description: "deploys"}, excerpts, map[string]bool{"check": true})
	if err != nil {
		t.Fatal(err)
	}
	if !hidden["old"] || hidden["note"] || hidden["check"] {
		t.Fatalf("hidden %+v", hidden)
	}
	if _, ok := ev.questions["m2"]; ok {
		t.Fatal("the check message was submitted to jev")
	}
	if _, asked := ev.questions["m0"]; !asked {
		t.Fatal("missing question for the old message")
	}
	state, ok := ev.state.(FilterState)
	if !ok || state.Agent.Name != "Ops" || len(state.Messages) != 3 || state.Messages[2].Content != "please check" {
		t.Fatalf("state %+v", ev.state)
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "a3") {
		t.Fatalf("agent id leaked into the filter state: %s", raw)
	}
}

func TestFilterForAgentKeepsEverythingWhenJevFails(t *testing.T) {
	ev := &scripted{enabled: true, err: errors.New("down")}
	excerpts := []Excerpt{{Turn: Turn{ID: "old", Text: "old"}, Index: 0}}
	hidden, err := FilterForAgent(context.Background(), ev, Card{Name: "Ops"}, excerpts, nil)
	if err == nil || hidden != nil {
		t.Fatalf("hidden %+v err %v", hidden, err)
	}
}

func TestFilterForAgentSkipsWhenNothingCanBeHidden(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{"m0": {Choice: "屏蔽"}}}
	excerpts := []Excerpt{{Turn: Turn{ID: "check", Text: "please check"}, Index: 0}}
	hidden, err := FilterForAgent(context.Background(), ev, Card{Name: "Ops"}, excerpts, map[string]bool{"check": true})
	if err != nil || hidden != nil || ev.called {
		t.Fatalf("hidden %+v err %v called %v", hidden, err, ev.called)
	}
	hidden, err = FilterForAgent(context.Background(), nil, Card{Name: "Ops"}, excerpts, nil)
	if err != nil || hidden != nil {
		t.Fatalf("nil evaluator hidden %+v err %v", hidden, err)
	}
}

func TestHideMessagesReplacesContentAndDropsQuotedSecrets(t *testing.T) {
	transcript := Transcript{Excerpts: []Excerpt{
		{Turn: Turn{ID: "old", Text: "secret", Ref: &Turn{ID: "q", Author: "Ada", Text: "quoted secret"}}, Index: 0, Truncated: true},
		{Turn: Turn{ID: "keep", Text: "see this", Ref: &Turn{ID: "old", Author: "Ada", Text: "secret"}}, Index: 1},
	}}
	HideMessages(&transcript, map[string]bool{"old": true})
	if transcript.Excerpts[0].Text != HiddenMessageText || transcript.Excerpts[0].Ref != nil || transcript.Excerpts[0].Truncated || !transcript.Excerpts[0].Hidden {
		t.Fatalf("hidden excerpt %+v", transcript.Excerpts[0])
	}
	if transcript.Excerpts[1].Text != "see this" || transcript.Excerpts[1].Ref != nil || transcript.Excerpts[1].Hidden {
		t.Fatalf("kept excerpt %+v", transcript.Excerpts[1])
	}
	out := transcript.Render("issue-1", "")
	if strings.Contains(out, "secret") || strings.Contains(out, "quoted") {
		t.Fatalf("withheld text leaked:\n%s", out)
	}
	if strings.Count(out, "<msg ") != 2 || !strings.Contains(out, ">***HIDDEN***</msg>") || !strings.Contains(out, `id="old"`) || !strings.Contains(out, "Its id attribute is unchanged") {
		t.Fatalf("render:\n%s", out)
	}
}
