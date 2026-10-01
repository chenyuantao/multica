package groupchat

import (
	"context"
	"errors"
	"testing"

	"github.com/multica-ai/multica/server/pkg/typesafe"
)

func roster() []Participant {
	return []Participant{
		{Type: "member", ID: "u1", Name: "Ada"},
		{Type: "agent", ID: "a1", Name: "Dev"},
		{Type: "agent", ID: "a2", Name: "Dev"},
		{Type: "agent", ID: "a3", Name: "Ops"},
	}
}

func TestRouteDirectLeadingMention(t *testing.T) {
	got := Route("[@Ops](mention://agent/a3) check the deploy", roster())
	if got.Kind != KindDirect || len(got.Agents) != 1 || got.Agents[0].ID != "a3" {
		t.Fatalf("got %+v", got)
	}
}

func TestRouteIgnoresQuotedMention(t *testing.T) {
	content := "what should we do?\n> [@Ops](mention://agent/a3) earlier note\n```\n@Ops\n```"
	got := Route(content, roster())
	if got.Kind != KindPolicy {
		t.Fatalf("quoted @ counted as an address: %+v", got)
	}
}

func TestRouteRejectsDuplicateBareName(t *testing.T) {
	got := Route("@Dev take this", roster())
	if got.Kind != KindAmbiguous || got.Name != "Dev" {
		t.Fatalf("got %+v", got)
	}
}

func TestRouteNamedKeepsOrder(t *testing.T) {
	content := "[@Ops](mention://agent/a3) then [@Dev](mention://agent/a1)"
	got := Route(content, roster())
	if got.Kind != KindNamed || len(got.Agents) != 2 || got.Agents[0].ID != "a3" || got.Agents[1].ID != "a1" {
		t.Fatalf("got %+v", got)
	}
}

func TestRouteHumanMentionWakesNobody(t *testing.T) {
	got := Route("@Ada what time?", roster())
	if got.Kind != KindNone {
		t.Fatalf("got %+v", got)
	}
}

func TestRouteProseMentionUsesPolicy(t *testing.T) {
	got := Route("please ask [@Ops](mention://agent/a3) about the deploy", roster())
	if got.Kind != KindPolicy {
		t.Fatalf("a mention in the sentence should stay with the group policy: %+v", got)
	}
}

func TestRouteUniqueBareName(t *testing.T) {
	got := Route("@Ops status", roster())
	if got.Kind != KindDirect || got.Agents[0].ID != "a3" {
		t.Fatalf("got %+v", got)
	}
}

type scripted struct {
	answers   map[string]typesafe.Answer
	questions map[string]any
	state     any
	err       error
	called    bool
	enabled   bool
}

func (s *scripted) Enabled() bool { return s.enabled }
func (s *scripted) Evaluate(_ context.Context, state any, questions map[string]any) (map[string]typesafe.Answer, error) {
	s.called = true
	s.state = state
	s.questions = questions
	return s.answers, s.err
}

func TestDecideDirectSkipsEvaluator(t *testing.T) {
	ev := &scripted{enabled: true}
	plan, err := Decide(context.Background(), ev, State{}, roster(), Address{
		Kind:   KindDirect,
		Agents: []Participant{{Type: "agent", ID: "a3", Name: "Ops"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if ev.called || plan.Mode != ModeSingle || len(plan.AgentIDs) != 1 || plan.AgentIDs[0] != "a3" {
		t.Fatalf("plan %+v called %v", plan, ev.called)
	}
}

func TestDecidePolicyUsesTheNamedAgentOnlyAfterYes(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{
		"reply": {Choice: "是"},
		"agent": {Choice: "Ops"},
	}}
	plan, err := Decide(context.Background(), ev, State{
		Agents: []Card{{ID: "a3", Name: "Ops", Description: "deploys"}},
	}, roster(), Address{Kind: KindPolicy})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Mode != ModeSingle || len(plan.AgentIDs) != 1 || plan.AgentIDs[0] != "a3" {
		t.Fatalf("plan %+v", plan)
	}
	if _, ok := ev.questions["reply"]; !ok {
		t.Fatal("missing reply question")
	}
	agentQ, _ := ev.questions["agent"].(map[string]any)
	criteria, _ := agentQ["criteria"].(map[string]string)
	if _, dup := criteria["Dev"]; dup {
		t.Fatal("a shared name must not be an option")
	}
	if criteria["Ops"] != "deploys" {
		t.Fatalf("criteria %+v", criteria)
	}
}

func TestDecidePolicyNoSkipsTheAgentAnswer(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{
		"reply": {Choice: "否"},
		"agent": {Choice: "Ops"},
	}}
	plan, err := Decide(context.Background(), ev, State{
		Agents: []Card{{ID: "a3", Name: "Ops", Description: "deploys"}},
	}, roster(), Address{Kind: KindPolicy})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Mode != ModeNone || len(plan.AgentIDs) != 0 {
		t.Fatalf("plan %+v", plan)
	}
}

func TestSequentialPlanStartsOneSpeaker(t *testing.T) {
	plan := Plan{Mode: ModeSequential, AgentIDs: []string{"a3", "a1"}}
	d, now := plan.Now()
	if len(now) != 1 || now[0] != "a3" || d.Cursor != 0 {
		t.Fatalf("dispatch %+v now %v", d, now)
	}
	next, id, ok := d.Next()
	if !ok || id != "a1" || next.Cursor != 1 {
		t.Fatalf("next %+v %s %v", next, id, ok)
	}
}

func TestDecideUnconfiguredIsUndecided(t *testing.T) {
	for _, address := range []Address{
		{Kind: KindPolicy},
		{Kind: KindNamed, Agents: []Participant{{Type: "agent", ID: "a3"}, {Type: "agent", ID: "a1"}}},
	} {
		if _, err := Decide(context.Background(), nil, State{}, roster(), address); !errors.Is(err, ErrUndecided) {
			t.Fatalf("%s: err %v", address.Kind, err)
		}
		if _, err := Decide(context.Background(), &scripted{}, State{}, roster(), address); !errors.Is(err, ErrUndecided) {
			t.Fatalf("%s disabled: err %v", address.Kind, err)
		}
	}
}

func TestDecideEvaluatorErrorIsUndecided(t *testing.T) {
	_, err := Decide(context.Background(), &scripted{enabled: true, err: errors.New("down")}, State{}, roster(), Address{
		Kind:   KindNamed,
		Agents: []Participant{{Type: "agent", ID: "a3"}, {Type: "agent", ID: "a1"}},
	})
	if !errors.Is(err, ErrUndecided) {
		t.Fatalf("err %v", err)
	}
}

func TestDecidePolicyUnknownAgentIsUndecided(t *testing.T) {
	ev := &scripted{enabled: true, answers: map[string]typesafe.Answer{
		"reply": {Choice: "是"},
		"agent": {Choice: "Nobody"},
	}}
	_, err := Decide(context.Background(), ev, State{
		Agents: []Card{{ID: "a3", Name: "Ops"}},
	}, roster(), Address{Kind: KindPolicy})
	if !errors.Is(err, ErrUndecided) {
		t.Fatalf("err %v", err)
	}
}

func TestOpenPlaceholderIgnoresAFilledBubble(t *testing.T) {
	if _, ok := OpenPlaceholder([]byte(`{"group_chat_placeholder":{"comment_id":"c1","open":false}}`)); ok {
		t.Fatal("filled placeholder should not be open")
	}
	got, ok := OpenPlaceholder([]byte(`{"group_chat_placeholder":{"comment_id":"c1","open":true}}`))
	if !ok || got.CommentID != "c1" {
		t.Fatalf("got %+v %v", got, ok)
	}
}

func TestPendingIncludesRestOfSequentialPlan(t *testing.T) {
	raw := []byte(`{"group_chat_dispatch":{"mode":"sequential","agent_ids":["a3","a1"],"cursor":0}}`)
	got := PendingAgentIDs([]ActiveTask{{AgentID: "a3", Context: raw}})
	if len(got) != 2 || got[0] != "a3" || got[1] != "a1" {
		t.Fatalf("got %v", got)
	}
}
