package groupchat

import (
	"strings"
	"testing"
)

func TestFallbackPlanKeepsNamedOrder(t *testing.T) {
	named := Address{Kind: KindNamed, Agents: []Participant{{Type: "agent", ID: "a3"}, {Type: "agent", ID: "a1"}}}
	if got := FallbackPlan(roster(), named); got.Mode != ModeSequential || strings.Join(got.AgentIDs, ",") != "a3,a1" {
		t.Fatalf("named fallback %+v", got)
	}
	if got := FallbackPlan(roster(), Address{Kind: KindPolicy}); got.Mode != ModeSingle || got.AgentIDs[0] != "a1" {
		t.Fatalf("policy fallback %+v", got)
	}
}
