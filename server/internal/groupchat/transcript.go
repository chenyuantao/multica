package groupchat

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	// minExcerptRunes is the shortest cut-down message worth showing. A
	// message that would be cut below this is left out instead.
	minExcerptRunes = 200
	// maxTranscriptMessages is how many of the newest messages a transcript
	// may include. Older messages are omitted.
	maxTranscriptMessages = 20
	// maxOmittedIDs caps the message ids listed for one omitted range.
	maxOmittedIDs = 5
)

// Excerpt is one message chosen for the transcript.
type Excerpt struct {
	Turn
	// Index is the message's position in the full history, so gaps show.
	Index int
	// Trigger marks a message this run was started to answer.
	Trigger bool
	// Truncated means Text is the head of a longer message.
	Truncated bool
	// Hidden means Text was replaced because this agent does not need the
	// original. The message stays so the gap is visible.
	Hidden bool
	// OmittedBefore are the messages left out between the previous excerpt
	// (or the start of history) and this one.
	OmittedBefore []Turn
}

// Transcript is the bounded history shown to the agent that replies.
type Transcript struct {
	// Title is the chat name; Notice is its announcement and may be empty.
	Title    string
	Notice   string
	Excerpts []Excerpt
	// OmittedAfter are the messages newer than the last excerpt that were left out.
	OmittedAfter []Turn
}

// SelectTranscript keeps the newest maxTranscriptMessages turns inside
// maxRunes. Older turns are omitted. The budget is filled in priority
// order: the latest message from a person, the messages that triggered
// this run (newest first), then everything else newest first. A forwarded
// chat record is not a request, so it is skipped while choosing that
// latest message and is never marked as a trigger. It is kept whole when
// it is included. Every other message is capped at perMessage runes.
// Excerpts come back in chronological order.
func SelectTranscript(turns []Turn, triggerIDs []string, maxRunes, perMessage int) Transcript {
	triggers := make(map[string]bool, len(triggerIDs))
	for _, id := range triggerIDs {
		if id = strings.TrimSpace(id); id != "" {
			triggers[id] = true
		}
	}
	windowStart := len(turns) - maxTranscriptMessages
	if windowStart < 0 {
		windowStart = 0
	}
	remaining := maxRunes
	chosen := make(map[int]Excerpt, len(turns))
	include := func(i int) {
		if _, ok := chosen[i]; ok || remaining <= 0 {
			return
		}
		turn := turns[i]
		text := strings.TrimSpace(turn.Text)
		overhead := tagRunes(turn)
		length := utf8.RuneCountInString(text)
		if turn.History {
			// The record is context and stays complete, even when it is longer
			// than one message's cap. It still spends budget, so older
			// messages stop once it has been taken.
			remaining -= overhead + length + refRunes(turn.Ref) + focusRunes(turn.Focus)
			turn.Text = text
			chosen[i] = Excerpt{Turn: turn, Index: i, Trigger: false}
			return
		}
		limit := min(perMessage, remaining-overhead)
		truncated := length > limit
		if truncated {
			if limit < minExcerptRunes {
				return
			}
			text = string([]rune(text)[:limit])
			length = limit
		}
		// A quote and the open note are always shown whole, so they spend budget
		// without being cut.
		remaining -= overhead + length + refRunes(turn.Ref) + focusRunes(turn.Focus)
		turn.Text = text
		chosen[i] = Excerpt{Turn: turn, Index: i, Trigger: triggers[turn.ID], Truncated: truncated}
	}
	for i := len(turns) - 1; i >= windowStart; i-- {
		if turns[i].Role == "member" && !turns[i].History {
			include(i)
			break
		}
	}
	for i := len(turns) - 1; i >= windowStart; i-- {
		if triggers[turns[i].ID] && !turns[i].History {
			include(i)
		}
	}
	for i := len(turns) - 1; i >= windowStart; i-- {
		include(i)
	}

	var out Transcript
	var skipped []Turn
	for i := range turns {
		e, ok := chosen[i]
		if !ok {
			skipped = append(skipped, turns[i])
			continue
		}
		e.OmittedBefore = skipped
		skipped = nil
		out.Excerpts = append(out.Excerpts, e)
	}
	out.OmittedAfter = skipped
	return out
}

// Render writes the transcript as a <group_chat> XML block. A group chat
// opens with its <title> and, when set, its <notice>. A direct chat leaves
// both unset. <desc> follows those and sits above every <msg>, so the stable
// markup explanation stays above the sliding history. Each <msg> is oldest
// first and carries its history index, id, time, sender and role; triggers,
// cut-down messages and quotes are marked on it, and omitted ranges become
// <omitted> elements. <desc> starts with intro and lists the commands that
// read cut-down or omitted messages. Message text is XML-escaped so it can
// never close or forge a tag.
func (t Transcript) Render(issueID, intro string) string {
	var truncated, omitted, quoted, focused, hidden, history bool
	for _, e := range t.Excerpts {
		truncated = truncated || e.Truncated
		omitted = omitted || len(e.OmittedBefore) > 0
		quoted = quoted || e.Ref != nil
		focused = focused || e.Focus != nil
		hidden = hidden || e.Hidden
		history = history || e.History || (e.Ref != nil && e.Ref.History)
	}
	omitted = omitted || len(t.OmittedAfter) > 0

	var b strings.Builder
	b.WriteString("<group_chat>\n")
	title, notice := strings.TrimSpace(t.Title), strings.TrimSpace(t.Notice)
	if title != "" {
		fmt.Fprintf(&b, "<title>%s</title>\n", escapeText(title))
	}
	if notice != "" {
		fmt.Fprintf(&b, "<notice>\n%s\n</notice>\n", escapeText(notice))
	}
	var desc []string
	if intro = strings.TrimSpace(intro); intro != "" {
		desc = append(desc, intro)
	}
	if title != "" {
		desc = append(desc, "title is the chat name.")
	}
	if notice != "" {
		desc = append(desc, "notice is the chat announcement members set for everyone in it.")
	}
	desc = append(desc, `Each msg element is one message, oldest first. index is its position in the chat history, sender is the display name, and role is member (a person) or agent. trigger="true" marks the messages this reply answers. Message text is XML-escaped.`)
	if hidden {
		desc = append(desc, fmt.Sprintf("A msg whose text is %q was withheld because this agent does not need it. Its id attribute is unchanged. Read the original with `multica issue comment list %s --thread ID --tail 0 --output json`.", HiddenMessageText, issueID))
	}
	if quoted {
		desc = append(desc, "A ref element inside a msg is the earlier message it quotes and replies to, in full.")
	}
	if focused {
		desc = append(desc, `A ref with role="document" is the knowledge note open beside the chat when that message was sent. The message is about that note. path is the note's path and the text is its title.`)
	}
	if history {
		desc = append(desc, `A msg or ref whose text starts with "[chat history]" is a forwarded record. The lines under that heading are the original messages in full, kept as context. That record is not a message this reply answers.`)
	}
	if truncated {
		desc = append(desc, fmt.Sprintf(`A msg with truncated="true" is cut short. Read it in full with `+"`multica issue comment list %s --thread ID --tail 0 --output json`.", issueID))
	}
	if omitted {
		desc = append(desc, fmt.Sprintf("An omitted element stands for messages left out, with their time span and ids. Read the messages after a time with `multica issue comment list %s --since TIME --output json`.", issueID))
	}
	fmt.Fprintf(&b, "<desc>\n%s\n</desc>\n", strings.Join(desc, "\n"))
	for _, e := range t.Excerpts {
		writeOmitted(&b, e.OmittedBefore)
		fmt.Fprintf(&b, `<msg index="%d"%s`, e.Index, turnAttrs(e.Turn))
		if e.Trigger {
			b.WriteString(` trigger="true"`)
		}
		if e.Truncated {
			b.WriteString(` truncated="true"`)
		}
		b.WriteString(">")
		if e.Ref != nil {
			fmt.Fprintf(&b, "\n<ref%s>%s</ref>\n", turnAttrs(*e.Ref), escapeText(strings.TrimSpace(e.Ref.Text)))
		}
		if e.Focus != nil {
			if e.Ref == nil {
				b.WriteString("\n")
			}
			fmt.Fprintf(&b, `<ref role="document" path="%s">%s</ref>`+"\n", escapeAttr(e.Focus.Path), escapeText(strings.TrimSpace(e.Focus.Name)))
		}
		b.WriteString(escapeText(e.Text))
		if e.Ref != nil || e.Focus != nil {
			b.WriteString("\n")
		}
		b.WriteString("</msg>\n")
	}
	writeOmitted(&b, t.OmittedAfter)
	b.WriteString("</group_chat>")
	return b.String()
}

func turnAttrs(turn Turn) string {
	var b strings.Builder
	fmt.Fprintf(&b, ` id="%s"`, escapeAttr(turn.ID))
	if turn.Time != "" {
		fmt.Fprintf(&b, ` time="%s"`, escapeAttr(turn.Time))
	}
	fmt.Fprintf(&b, ` sender="%s" role="%s"`, escapeAttr(turn.Author), escapeAttr(turn.Role))
	return b.String()
}

// tagRunes estimates the markup around one message's text.
func tagRunes(turn Turn) int {
	return utf8.RuneCountInString(turnAttrs(turn)) + 60
}

func refRunes(ref *Turn) int {
	if ref == nil {
		return 0
	}
	return utf8.RuneCountInString(ref.Text) + tagRunes(*ref)
}

func focusRunes(note *FocusNote) int {
	if note == nil {
		return 0
	}
	return utf8.RuneCountInString(note.Name) + utf8.RuneCountInString(note.Path) + 40
}

var (
	textEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	attrEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "\n", " ", "\r", " ", "\t", " ")
)

func escapeText(s string) string { return textEscaper.Replace(s) }

func escapeAttr(s string) string { return attrEscaper.Replace(s) }

func writeOmitted(b *strings.Builder, turns []Turn) {
	if len(turns) == 0 {
		return
	}
	fmt.Fprintf(b, `<omitted count="%d"`, len(turns))
	if first, last := turns[0].Time, turns[len(turns)-1].Time; first != "" && last != "" {
		fmt.Fprintf(b, ` from="%s" to="%s"`, escapeAttr(first), escapeAttr(last))
	}
	ids := make([]string, 0, min(len(turns), maxOmittedIDs))
	for _, turn := range turns[:min(len(turns), maxOmittedIDs)] {
		ids = append(ids, turn.ID)
	}
	fmt.Fprintf(b, ` ids="%s"`, escapeAttr(strings.Join(ids, ",")))
	if extra := len(turns) - len(ids); extra > 0 {
		fmt.Fprintf(b, ` more="%d"`, extra)
	}
	b.WriteString("/>\n")
}
