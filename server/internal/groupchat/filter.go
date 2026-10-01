package groupchat

import (
	"context"
	"fmt"
	"strings"
)

// HiddenMessageText replaces a message withheld from the selected agent.
// The message stays in the transcript, with its id, so the agent can read
// the original through the comment tool.
const HiddenMessageText = "***HIDDEN***"

// FilterState is the second Jev request. The agent is already chosen; each
// question asks whether one delivered message should be hidden from that agent.
type FilterState struct {
	Agent    Card            `json:"agent"`
	Messages []FilterMessage `json:"messages"`
}

// FilterMessage is one transcript message the filter may judge. Index matches
// the history index on the delivered msg element.
type FilterMessage struct {
	Index   int    `json:"index"`
	Time    string `json:"time"`
	Sender  string `json:"sender"`
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ProtectedBurst is the latest member check message and the contiguous
// messages that same person sent immediately before it. Those cannot be
// hidden. triggerIDs are the comments this run answers; when none of them is
// a member message, the latest member message is the check.
func ProtectedBurst(turns []Turn, triggerIDs []string) map[string]bool {
	triggers := make(map[string]bool, len(triggerIDs))
	for _, id := range triggerIDs {
		if id = strings.TrimSpace(id); id != "" {
			triggers[id] = true
		}
	}
	anchor := -1
	for i := len(turns) - 1; i >= 0; i-- {
		if turns[i].Role == "member" && triggers[turns[i].ID] {
			anchor = i
			break
		}
	}
	if anchor < 0 {
		for i := len(turns) - 1; i >= 0; i-- {
			if turns[i].Role == "member" {
				anchor = i
				break
			}
		}
	}
	if anchor < 0 {
		return nil
	}
	who := senderKey(turns[anchor])
	out := map[string]bool{}
	for i := anchor; i >= 0; i-- {
		if turns[i].Role != "member" || senderKey(turns[i]) != who {
			break
		}
		if turns[i].ID != "" {
			out[turns[i].ID] = true
		}
	}
	return out
}

// RequiredVisible is every message the filter must keep: the check burst,
// and any message that carries an attachment. Jev is not asked about them.
func RequiredVisible(turns []Turn, triggerIDs []string) map[string]bool {
	out := ProtectedBurst(turns, triggerIDs)
	for _, turn := range turns {
		if !turn.Attachment || turn.ID == "" {
			continue
		}
		if out == nil {
			out = map[string]bool{}
		}
		out[turn.ID] = true
	}
	return out
}

func senderKey(turn Turn) string {
	id := turn.AuthorID
	if id == "" {
		id = turn.Author
	}
	return turn.Role + "\x00" + id
}

// FilterForAgent asks, in one call, whether each delivered message should be
// hidden from agent. Protected ids are not submitted and are never hidden.
// A disabled evaluator, a failed call, or any answer other than 屏蔽 keeps
// the message.
func FilterForAgent(ctx context.Context, ev Evaluator, agent Card, excerpts []Excerpt, protected map[string]bool) (map[string]bool, error) {
	if ev == nil || !ev.Enabled() {
		return nil, nil
	}
	name := strings.TrimSpace(agent.Name)
	if name == "" {
		name = "这名 Agent"
	}
	messages := make([]FilterMessage, 0, len(excerpts))
	questions := map[string]any{}
	keyToID := map[string]string{}
	for _, excerpt := range excerpts {
		messages = append(messages, FilterMessage{
			Index:   excerpt.Index,
			Time:    excerpt.Time,
			Sender:  excerpt.Author,
			Role:    excerpt.Role,
			Content: filterContent(excerpt),
		})
		if excerpt.ID == "" || excerpt.Attachment || protected[excerpt.ID] {
			continue
		}
		key := fmt.Sprintf("m%d", excerpt.Index)
		keyToID[key] = excerpt.ID
		questions[key] = map[string]any{
			"type":         "choice",
			"instructions": fmt.Sprintf("对照用户当前的问题，index 为 %d 的消息（发送者 %s）是否要对「%s」隐藏？只判断这一条，其余消息只作为上下文。", excerpt.Index, excerpt.Author, name),
			"criteria": map[string]string{
				"保留": "回复当前问题需要看到这条消息。",
				"屏蔽": "这条消息与当前问题无关，这名 Agent 不需要关心。",
			},
		}
	}
	if len(questions) == 0 {
		return nil, nil
	}
	answers, err := ev.Evaluate(ctx, FilterState{Agent: agent, Messages: messages}, questions)
	if err != nil {
		return nil, err
	}
	hidden := map[string]bool{}
	for key, id := range keyToID {
		if protected[id] {
			continue
		}
		if answers[key].Choice == "屏蔽" {
			hidden[id] = true
		}
	}
	if len(hidden) == 0 {
		return nil, nil
	}
	return hidden, nil
}

func filterContent(excerpt Excerpt) string {
	text := strings.TrimSpace(excerpt.Text)
	if excerpt.Ref == nil {
		return text
	}
	quote := strings.TrimSpace(excerpt.Ref.Text)
	if quote == "" {
		return text
	}
	return "引用 " + strings.TrimSpace(excerpt.Ref.Author) + "：" + quote + "\n" + text
}

// HideMessages replaces hidden messages in place. A kept message that quotes
// a hidden one loses that quote, so the withheld text is not copied in.
func HideMessages(transcript *Transcript, hidden map[string]bool) {
	if transcript == nil || len(hidden) == 0 {
		return
	}
	for i := range transcript.Excerpts {
		excerpt := &transcript.Excerpts[i]
		if excerpt.Ref != nil && excerpt.Ref.ID != "" && !excerpt.Ref.Attachment && hidden[excerpt.Ref.ID] {
			excerpt.Ref = nil
		}
		if excerpt.ID == "" || excerpt.Attachment || !hidden[excerpt.ID] {
			continue
		}
		excerpt.Text = HiddenMessageText
		excerpt.Truncated = false
		excerpt.Ref = nil
		excerpt.Hidden = true
	}
}
