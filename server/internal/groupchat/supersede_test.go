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
		"relation": {Type: "choice", Choice: "追加", Confidence: supersedeConfidenceFloor},
	}}
	got, exchange, err := Supersedes(context.Background(), ev, "check the deploy", "and include the logs")
	if err != nil || !got || !ev.called || exchange == nil {
		t.Fatalf("got %v err %v called %v exchange %#v", got, err, ev.called, exchange)
	}
	state, ok := ev.state.(SupersedeState)
	if !ok || state.Previous != "check the deploy" || state.Latest != "and include the logs" {
		t.Fatalf("state = %#v", ev.state)
	}
	relation := ev.questions["relation"].(map[string]any)
	instructions := relation["instructions"].(string)
	criteria := relation["criteria"].(map[string]string)
	if !strings.Contains(instructions, "拿不准就选「新问题」") || !strings.Contains(criteria["追加"], "不构成一个能单独回答的请求") {
		t.Fatalf("supersede prompt is not conservative: %s %v", instructions, criteria)
	}
	if exchange.Response["relation"].Choice != "追加" {
		t.Fatalf("exchange response = %#v", exchange.Response)
	}
	reqState, ok := exchange.Request["state"].(SupersedeState)
	if !ok || reqState.Previous != "check the deploy" {
		t.Fatalf("exchange request = %#v", exchange.Request)
	}

	ev.answers["relation"] = typesafe.Answer{Type: "choice", Choice: "追加", Confidence: supersedeConfidenceFloor - 0.01}
	got, exchange, err = Supersedes(context.Background(), ev, "check the deploy", "and include the logs")
	if err != nil || got || exchange != nil {
		t.Fatalf("low confidence = %v err %v exchange %#v", got, err, exchange)
	}

	ev.answers["relation"] = typesafe.Answer{Type: "choice", Choice: "新问题"}
	got, exchange, err = Supersedes(context.Background(), ev, "check the deploy", "what is for lunch")
	if err != nil || got || exchange != nil {
		t.Fatalf("new question = %v err %v exchange %#v", got, err, exchange)
	}

	ev.enabled = false
	ev.called = false
	got, exchange, err = Supersedes(context.Background(), ev, "check the deploy", "and include the logs")
	if err != nil || got || ev.called || exchange != nil {
		t.Fatalf("disabled = %v err %v called %v exchange %#v", got, err, ev.called, exchange)
	}

	ev.enabled = true
	ev.err = errors.New("down")
	got, exchange, err = Supersedes(context.Background(), ev, "check the deploy", "and include the logs")
	if err == nil || got || exchange != nil {
		t.Fatalf("failure = %v err %v exchange %#v", got, err, exchange)
	}

	ev.err = nil
	ev.answers["relation"] = typesafe.Answer{Type: "choice", Choice: "maybe"}
	if _, _, err = Supersedes(context.Background(), ev, "check the deploy", "and include the logs"); !errors.Is(err, ErrUndecided) {
		t.Fatalf("unknown = %v", err)
	}

	ev.called = false
	if got, exchange, err = Supersedes(context.Background(), ev, "   ", "hello"); err != nil || got || ev.called || exchange != nil {
		t.Fatalf("blank previous = %v err %v called %v exchange %#v", got, err, ev.called, exchange)
	}
}

func TestSupersedesClipsLongText(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{
		"relation": {Type: "choice", Choice: "新问题"},
	}}
	long := strings.Repeat("甲", supersedeRunes+10)
	if _, _, err := Supersedes(context.Background(), ev, long, "next"); err != nil {
		t.Fatal(err)
	}
	state := ev.state.(SupersedeState)
	if len([]rune(state.Previous)) != supersedeRunes {
		t.Fatalf("previous runes = %d", len([]rune(state.Previous)))
	}
}

func TestCancelledNoticeQuotesTheTriggerOnOneLine(t *testing.T) {
	got := CancelledNotice("  check\nthe   deploy  ", nil)
	if !strings.HasPrefix(got, "```"+cancelledFence+"\n") || !strings.HasSuffix(got, "\n```") {
		t.Fatalf("notice = %q", got)
	}
	if !strings.Contains(got, `"trigger":"check the deploy"`) {
		t.Fatalf("trigger = %q", got)
	}
	long := CancelledNotice(strings.Repeat("甲", cancelledNoticeRunes+10), nil)
	if strings.Count(long, "甲") != cancelledNoticeRunes {
		t.Fatalf("trigger runes = %d", strings.Count(long, "甲"))
	}
}

func TestCancelledNoticeStoresTheJevExchange(t *testing.T) {
	got := CancelledNotice("check the deploy", &SupersedeExchange{
		Request:  map[string]any{"state": SupersedeState{Previous: "a", Latest: "b"}},
		Response: map[string]typesafe.Answer{"relation": {Type: "choice", Choice: "追加", Confidence: 0.9}},
	})
	if !strings.Contains(got, `"previous":"a"`) || !strings.Contains(got, `"choice":"追加"`) {
		t.Fatalf("exchange missing from notice: %s", got)
	}
}
