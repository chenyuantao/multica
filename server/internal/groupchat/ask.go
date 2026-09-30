package groupchat

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const (
	// AskNoteMaxRunes caps the note body shown to the planner.
	AskNoteMaxRunes = 24000
	// AskMessageMaxRunes caps each on-screen chat message.
	AskMessageMaxRunes = 4000
	// AskMaxMessages caps the on-screen chat messages.
	AskMaxMessages = 50
)

// ErrNoAnswerer means the asker cannot open a direct chat with any agent.
var ErrNoAnswerer = errors.New("groupchat: no agent can answer")

// AskState is what the planner sees when someone asks AI from the quick
// switcher: the question, the page it was asked from, and the agents that
// could answer it in a direct chat. Agent IDs are the answer options.
type AskState struct {
	Query       string          `json:"query"`
	Page        *AskPage        `json:"page,omitempty"`
	Attachments []AskAttachment `json:"attachments,omitempty"`
	Agents      []AskAgent      `json:"agents"`
}

// AskAttachment is a file sent with the question. The planner sees its name
// and type only.
type AskAttachment struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
}

type AskAgent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// AskPage is the one surface the question was asked from, plus the message
// the person picked on it.
type AskPage struct {
	Note      *AskNote      `json:"note,omitempty"`
	Chat      *AskChat      `json:"chat,omitempty"`
	Contact   *AskContact   `json:"contact,omitempty"`
	Selection *AskSelection `json:"selection,omitempty"`
}

// AskSelection is a chat message the question was asked about. Text is the
// part of it the person highlighted; empty means the whole message.
type AskSelection struct {
	MessageID string `json:"message_id"`
	Time      string `json:"time"`
	Sender    string `json:"sender"`
	Content   string `json:"content"`
	Text      string `json:"text,omitempty"`
}

type AskNote struct {
	Title      string `json:"title"`
	Path       string `json:"path"`
	ModifiedAt string `json:"modified_at"`
	Content    string `json:"content"`
	// Truncated reports that Content was cut at AskNoteMaxRunes.
	Truncated bool `json:"truncated,omitempty"`
}

type AskChat struct {
	Title    string    `json:"title"`
	Agents   []string  `json:"agents"`
	Messages []Message `json:"messages"`
}

type AskContact struct {
	// Type is "member" for a person or "agent".
	Type        string `json:"type"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Clamp enforces the size limits on a page sent by the client.
func (p *AskPage) Clamp() {
	if p == nil {
		return
	}
	if p.Note != nil {
		var cut bool
		p.Note.Content, cut = truncateRunes(p.Note.Content, AskNoteMaxRunes)
		p.Note.Truncated = p.Note.Truncated || cut
	}
	if p.Chat != nil {
		if len(p.Chat.Messages) > AskMaxMessages {
			p.Chat.Messages = p.Chat.Messages[len(p.Chat.Messages)-AskMaxMessages:]
		}
		for i := range p.Chat.Messages {
			p.Chat.Messages[i].Content, _ = truncateRunes(p.Chat.Messages[i].Content, AskMessageMaxRunes)
		}
	}
	if p.Selection != nil {
		p.Selection.Content, _ = truncateRunes(p.Selection.Content, AskMessageMaxRunes)
		p.Selection.Text, _ = truncateRunes(p.Selection.Text, AskMessageMaxRunes)
	}
}

// Empty reports whether the page carries nothing to show.
func (p *AskPage) Empty() bool {
	return p == nil || (p.Note == nil && p.Chat == nil && p.Contact == nil && p.Selection == nil)
}

// RenderAskContext writes the page a message was asked from as an
// <ask_ai_context> XML block for the agent answering that message. All text
// is XML-escaped so it can never close or forge a tag.
func RenderAskContext(messageID string, p *AskPage) string {
	if p.Empty() {
		return ""
	}
	var b strings.Builder
	var desc []string
	fmt.Fprintf(&b, "<ask_ai_context message_id=\"%s\">\n", escapeAttr(messageID))
	if n := p.Note; n != nil {
		fmt.Fprintf(&b, `<note title="%s" path="%s"`, escapeAttr(n.Title), escapeAttr(n.Path))
		if n.ModifiedAt != "" {
			fmt.Fprintf(&b, ` modified_at="%s"`, escapeAttr(n.ModifiedAt))
		}
		if n.Truncated {
			b.WriteString(` truncated="true"`)
		}
		fmt.Fprintf(&b, ">%s</note>\n", escapeText(n.Content))
		desc = append(desc, `note is the knowledge note that was open, with its body; truncated="true" means the body was cut short.`)
	}
	if c := p.Chat; c != nil {
		fmt.Fprintf(&b, "<chat title=\"%s\">\n", escapeAttr(c.Title))
		for _, name := range c.Agents {
			fmt.Fprintf(&b, "<agent name=\"%s\"/>\n", escapeAttr(name))
		}
		for _, m := range c.Messages {
			fmt.Fprintf(&b, "<msg time=\"%s\" sender=\"%s\">%s</msg>\n", escapeAttr(m.Time), escapeAttr(m.Sender), escapeText(m.Content))
		}
		b.WriteString("</chat>\n")
		desc = append(desc, "chat is the chat that was open: its agents and the messages that were on screen, oldest first.")
	}
	if c := p.Contact; c != nil {
		fmt.Fprintf(&b, "<contact type=\"%s\" name=\"%s\">%s</contact>\n", escapeAttr(c.Type), escapeAttr(c.Name), escapeText(c.Description))
		desc = append(desc, "contact is the profile that was open; type is member (a person) or agent, and the text is its description.")
	}
	if s := p.Selection; s != nil {
		fmt.Fprintf(&b, "<selection message_id=\"%s\" time=\"%s\" sender=\"%s\">\n", escapeAttr(s.MessageID), escapeAttr(s.Time), escapeAttr(s.Sender))
		fmt.Fprintf(&b, "<message>%s</message>\n", escapeText(s.Content))
		if s.Text != "" {
			fmt.Fprintf(&b, "<highlight>%s</highlight>\n", escapeText(s.Text))
		}
		b.WriteString("</selection>\n")
		desc = append(desc, "selection is the message the person asked about; highlight, when present, is the part of it they selected.")
	}
	fmt.Fprintf(&b, "<desc>\nThe person sent the message with this message_id through Ask AI from the page described here. Use it as context for your answer.\n%s\n</desc>\n</ask_ai_context>", strings.Join(desc, "\n"))
	return b.String()
}

// ChooseAnswerer asks the planner which agent should answer the question in
// a direct chat and returns that agent's ID. A single candidate is returned
// without a call.
func ChooseAnswerer(ctx context.Context, ev Evaluator, state AskState) (string, error) {
	criteria := map[string]string{}
	for _, agent := range state.Agents {
		if agent.ID == "" {
			continue
		}
		criteria[agent.ID] = strings.TrimSpace(agent.Name + "：" + agent.Description)
	}
	switch len(criteria) {
	case 0:
		return "", ErrNoAnswerer
	case 1:
		for id := range criteria {
			return id, nil
		}
	}
	if ev == nil || !ev.Enabled() {
		return "", fmt.Errorf("%w: not configured", ErrUndecided)
	}
	answers, err := ev.Evaluate(ctx, state, map[string]any{
		"agent": map[string]any{
			"type":         "choice",
			"instructions": "用户在当前页面向 AI 提问。应由哪名 Agent 在单聊中回答？每个选项是一名 Agent 的 ID。",
			"criteria":     criteria,
		},
	})
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUndecided, err)
	}
	id := answers["agent"].Choice
	if _, ok := criteria[id]; !ok {
		return "", fmt.Errorf("%w: agent answer %q", ErrUndecided, id)
	}
	return id, nil
}

func truncateRunes(s string, n int) (string, bool) {
	count := 0
	for i := range s {
		if count == n {
			return s[:i], true
		}
		count++
	}
	return s, false
}
