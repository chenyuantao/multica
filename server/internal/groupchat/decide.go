package groupchat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/multica-ai/multica/server/pkg/typesafe"
)

// Mode is how the selected agents speak.
type Mode string

const (
	ModeNone       Mode = "none"
	ModeSingle     Mode = "single"
	ModeParallel   Mode = "parallel"
	ModeSequential Mode = "sequential"
)

// Plan is who speaks, and in what relation.
type Plan struct {
	Mode     Mode
	AgentIDs []string
}

// Dispatch is the plan plus the cursor of the agent who should run now.
// Sequential plans enqueue one agent at a time; Cursor is that agent's index.
type Dispatch struct {
	Mode     Mode     `json:"mode"`
	AgentIDs []string `json:"agent_ids"`
	Cursor   int      `json:"cursor"`
}

// ErrUndecided means Jev gave no usable answer: it is not configured, the
// call failed, or its answer does not map to a plan. The caller then uses
// FallbackPlan.
var ErrUndecided = errors.New("groupchat: jev gave no usable decision")

// Evaluator is the Jev call. A nil or disabled evaluator makes Decide return
// ErrUndecided for any address that needs planning.
type Evaluator interface {
	Enabled() bool
	Evaluate(ctx context.Context, state any, questions map[string]any) (map[string]typesafe.Answer, error)
}

// State is what a planning call shows the model: the agents who can take
// over, and the recent messages. IDs stay off the wire; the program maps a
// chosen name back to an agent.
type State struct {
	Agents   []Card    `json:"agents"`
	Messages []Message `json:"messages"`
}

// Message is one recent group message.
type Message struct {
	Time    string `json:"time"`
	Sender  string `json:"sender"`
	Content string `json:"content"`
}

// Turn is one message while the server is still assembling history.
type Turn struct {
	ID     string
	Author string
	Role   string
	Text   string
	Time   string
	// Ref is the message this one quotes, carried in full.
	Ref *Turn
}

// Card is an agent the planner may choose. ID is not sent to the model.
type Card struct {
	ID          string `json:"-"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

const (
	// ModeConfidenceFloor drops a low-confidence order. Named agents then
	// keep mention order.
	ModeConfidenceFloor = 0.35
)

// Decide turns an address into a plan. Direct and none addresses do not call
// the evaluator. Named addresses ask only whether the work is parallel or
// ordered. An unaddressed message asks whether any agent should reply, and
// only then which one. Any planning failure is ErrUndecided.
func Decide(ctx context.Context, ev Evaluator, state State, roster []Participant, address Address) (Plan, error) {
	switch address.Kind {
	case KindNone, KindAmbiguous:
		return Plan{Mode: ModeNone}, nil
	case KindDirect:
		return Plan{Mode: ModeSingle, AgentIDs: ids(address.Agents)}, nil
	}
	if ev == nil || !ev.Enabled() {
		return Plan{}, fmt.Errorf("%w: not configured", ErrUndecided)
	}
	var plan Plan
	var err error
	if address.Kind == KindNamed {
		plan, err = decideNamed(ctx, ev, state, address.Agents)
	} else {
		plan, err = decidePolicy(ctx, ev, state, AgentsOf(roster))
	}
	if err != nil && !errors.Is(err, ErrUndecided) {
		err = fmt.Errorf("%w: %v", ErrUndecided, err)
	}
	return plan, err
}

func decideNamed(ctx context.Context, ev Evaluator, state State, agents []Participant) (Plan, error) {
	answers, err := ev.Evaluate(ctx, state, map[string]any{
		"order": map[string]any{
			"type":         "choice",
			"instructions": "These agents were named in the latest message. Can they answer independently, or must a later answer wait for an earlier one?",
			"criteria": map[string]string{
				"parallel":   "Each named agent can answer without the others' replies.",
				"sequential": "A later reply depends on an earlier one, so they must go in the order they were named.",
			},
		},
	})
	if err != nil {
		return Plan{}, err
	}
	a, ok := answers["order"]
	if !ok || (a.Choice != "parallel" && a.Choice != "sequential") {
		return Plan{}, fmt.Errorf("%w: order answer %q", ErrUndecided, a.Choice)
	}
	mode := ModeSequential
	if a.Choice == "parallel" && a.Confidence >= ModeConfidenceFloor {
		mode = ModeParallel
	}
	return Plan{Mode: mode, AgentIDs: ids(agents)}, nil
}

func decidePolicy(ctx context.Context, ev Evaluator, state State, agents []Participant) (Plan, error) {
	criteria, optionToID := agentChoices(cardsFor(agents, state.Agents))
	if len(criteria) == 0 {
		return Plan{}, fmt.Errorf("%w: no agent can be offered by name", ErrUndecided)
	}
	answers, err := ev.Evaluate(ctx, state, map[string]any{
		"reply": map[string]any{
			"type":         "choice",
			"instructions": "当前消息是否需要由 Agent 回复？",
			"criteria": map[string]string{
				"是": "需要由一名 Agent 接管并回复。",
				"否": "不需要任何 Agent 回复。",
			},
		},
		"agent": map[string]any{
			"type":         "choice",
			"instructions": "应由哪名 Agent 负责回复？每个选项是一名 Agent 的名称。",
			"criteria":     criteria,
		},
	})
	if err != nil {
		return Plan{}, err
	}
	switch answers["reply"].Choice {
	case "否":
		return Plan{Mode: ModeNone}, nil
	case "是":
	default:
		return Plan{}, fmt.Errorf("%w: reply answer %q", ErrUndecided, answers["reply"].Choice)
	}
	id := optionToID[answers["agent"].Choice]
	if id == "" {
		return Plan{}, fmt.Errorf("%w: agent answer %q", ErrUndecided, answers["agent"].Choice)
	}
	return Plan{Mode: ModeSingle, AgentIDs: []string{id}}, nil
}

// agentChoices keys each option by the agent's name. A name shared by two
// agents is not offered under that bare name, so the model cannot be asked
// to guess which one.
func agentChoices(cards []Card) (map[string]string, map[string]string) {
	counts := map[string]int{}
	for _, card := range cards {
		counts[card.Name]++
	}
	criteria := map[string]string{}
	optionToID := map[string]string{}
	for _, card := range cards {
		if card.Name == "" || counts[card.Name] != 1 || card.ID == "" {
			continue
		}
		criteria[card.Name] = card.Description
		optionToID[card.Name] = card.ID
	}
	return criteria, optionToID
}

func cardsFor(agents []Participant, cards []Card) []Card {
	byID := map[string]Card{}
	for _, card := range cards {
		byID[card.ID] = card
	}
	out := make([]Card, 0, len(agents))
	for _, agent := range agents {
		card := byID[agent.ID]
		name := agent.Name
		if card.Name != "" {
			name = card.Name
		}
		out = append(out, Card{ID: agent.ID, Name: name, Description: card.Description})
	}
	return out
}

// Now returns the agents to enqueue immediately. Sequential plans start at
// cursor 0; the rest wait until that run finishes.
func (p Plan) Now() (Dispatch, []string) {
	if len(p.AgentIDs) == 0 || p.Mode == ModeNone {
		return Dispatch{}, nil
	}
	if p.Mode == ModeSequential && len(p.AgentIDs) > 1 {
		d := Dispatch{Mode: p.Mode, AgentIDs: p.AgentIDs, Cursor: 0}
		return d, []string{p.AgentIDs[0]}
	}
	return Dispatch{}, p.AgentIDs
}

// Next is the following agent in a sequential dispatch, if this run was the
// one at Cursor and someone remains.
func (d Dispatch) Next() (Dispatch, string, bool) {
	if d.Mode != ModeSequential {
		return Dispatch{}, "", false
	}
	i := d.Cursor + 1
	if i >= len(d.AgentIDs) {
		return Dispatch{}, "", false
	}
	d.Cursor = i
	return d, d.AgentIDs[i], true
}

// ParseDispatch reads a plan stored on a task. ok is false when the task
// does not carry one.
func ParseDispatch(raw []byte) (Dispatch, bool) {
	if len(raw) == 0 {
		return Dispatch{}, false
	}
	var envelope struct {
		GroupChatDispatch Dispatch `json:"group_chat_dispatch"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return Dispatch{}, false
	}
	if len(envelope.GroupChatDispatch.AgentIDs) == 0 {
		return Dispatch{}, false
	}
	return envelope.GroupChatDispatch, true
}

// ThinkingMessage is the bubble posted the moment an agent is chosen to reply.
// The finished text replaces it in place.
const ThinkingMessage = "思考中..."

// UnfinishedMessage replaces ThinkingMessage when the run ends without a reply.
const UnfinishedMessage = "这次没有完成回复。"

// Placeholder is the thinking bubble stored on the task that will fill it.
type Placeholder struct {
	CommentID string `json:"comment_id"`
	Open      bool   `json:"open"`
}

// OpenPlaceholder is the thinking bubble this task still has to fill.
func OpenPlaceholder(raw []byte) (Placeholder, bool) {
	if len(raw) == 0 {
		return Placeholder{}, false
	}
	var envelope struct {
		GroupChatPlaceholder Placeholder `json:"group_chat_placeholder"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return Placeholder{}, false
	}
	if !envelope.GroupChatPlaceholder.Open || strings.TrimSpace(envelope.GroupChatPlaceholder.CommentID) == "" {
		return Placeholder{}, false
	}
	return envelope.GroupChatPlaceholder, true
}

// PendingAgentIDs is who has not finished speaking. An active sequential
// plan contributes everyone from its cursor on. Any other active task
// contributes its own agent.
func PendingAgentIDs(tasks []ActiveTask) []string {
	seen := map[string]bool{}
	var out []string
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		out = append(out, id)
	}
	for _, task := range tasks {
		if d, ok := ParseDispatch(task.Context); ok && d.Mode == ModeSequential {
			for _, id := range d.AgentIDs[min(d.Cursor, len(d.AgentIDs)):] {
				add(id)
			}
			continue
		}
		add(task.AgentID)
	}
	return out
}

// ActiveTask is the slice of a queue row the pending list needs.
type ActiveTask struct {
	AgentID string
	Context []byte
}

func ids(ps []Participant) []string {
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.ID)
	}
	return out
}

// AgentsOf keeps the agents of a roster, in roster order.
func AgentsOf(ps []Participant) []Participant {
	var out []Participant
	for _, p := range ps {
		if p.Type == "agent" {
			out = append(out, p)
		}
	}
	return out
}
