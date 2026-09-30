package groupchat

// FallbackPlan is the plan when Jev did not decide. Named agents speak in the
// order they were named; anything else goes to the group's first agent.
func FallbackPlan(roster []Participant, address Address) Plan {
	if address.Kind == KindNamed && len(address.Agents) > 0 {
		return Plan{Mode: ModeSequential, AgentIDs: ids(address.Agents)}
	}
	agents := AgentsOf(roster)
	if len(agents) == 0 {
		return Plan{Mode: ModeNone}
	}
	return Plan{Mode: ModeSingle, AgentIDs: []string{agents[0].ID}}
}
