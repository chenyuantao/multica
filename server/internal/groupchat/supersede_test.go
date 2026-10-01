package groupchat

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/pkg/typesafe"
)

func TestSupersedes(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{
		"relation": {Type: "choice", Choice: "追加"},
	}}
	got, err := Supersedes(context.Background(), ev, "check the deploy", "and include the logs")
	if err != nil || !got || !ev.called {
		t.Fatalf("got %v err %v called %v", got, err, ev.called)
	}
	state, ok := ev.state.(SupersedeState)
	if !ok || state.Previous != "check the deploy" || state.Latest != "and include the logs" {
		t.Fatalf("state = %#v", ev.state)
	}

	ev.answers["relation"] = typesafe.Answer{Type: "choice", Choice: "新问题"}
	got, err = Supersedes(context.Background(), ev, "check the deploy", "what is for lunch")
	if err != nil || got {
		t.Fatalf("new question = %v err %v", got, err)
	}

	ev.enabled = false
	ev.called = false
	got, err = Supersedes(context.Background(), ev, "check the deploy", "and include the logs")
	if err != nil || got || ev.called {
		t.Fatalf("disabled = %v err %v called %v", got, err, ev.called)
	}

	ev.enabled = true
	ev.err = errors.New("down")
	got, err = Supersedes(context.Background(), ev, "check the deploy", "and include the logs")
	if err == nil || got {
		t.Fatalf("failure = %v err %v", got, err)
	}

	ev.err = nil
	ev.answers["relation"] = typesafe.Answer{Type: "choice", Choice: "maybe"}
	if _, err = Supersedes(context.Background(), ev, "check the deploy", "and include the logs"); !errors.Is(err, ErrUndecided) {
		t.Fatalf("unknown = %v", err)
	}

	ev.called = false
	if got, err = Supersedes(context.Background(), ev, "   ", "hello"); err != nil || got || ev.called {
		t.Fatalf("blank previous = %v err %v called %v", got, err, ev.called)
	}
}

func TestSupersedesClipsLongText(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{
		"relation": {Type: "choice", Choice: "新问题"},
	}}
	long := strings.Repeat("甲", supersedeRunes+10)
	if _, err := Supersedes(context.Background(), ev, long, "next"); err != nil {
		t.Fatal(err)
	}
	state := ev.state.(SupersedeState)
	if len([]rune(state.Previous)) != supersedeRunes {
		t.Fatalf("previous runes = %d", len([]rune(state.Previous)))
	}
}
