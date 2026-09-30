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
	// maxOmittedIDs caps the message ids listed for one omitted range.
	maxOmittedIDs = 5
)

// Excerpt is one message chosen for the transcript.
type Excerpt struct {
	Turn
	// Trigger marks a message this run was started to answer.
	Trigger bool
	// Truncated means Text is the head of a longer message.
	Truncated bool
	// OmittedBefore are the messages left out between the previous excerpt
	// (or the start of history) and this one.
	OmittedBefore []Turn
}

// Transcript is the bounded history shown to the agent that replies.
type Transcript struct {
	Excerpts []Excerpt
	// OmittedAfter are the messages newer than the last excerpt that were left out.
	OmittedAfter []Turn
}

// SelectTranscript keeps turns inside maxRunes. The budget is filled in
// priority order: the latest message from a person, the messages that
// triggered this run (newest first), then everything else newest first.
// Each message is capped at perMessage runes. Excerpts come back in
// chronological order.
func SelectTranscript(turns []Turn, triggerIDs []string, maxRunes, perMessage int) Transcript {
	triggers := make(map[string]bool, len(triggerIDs))
	for _, id := range triggerIDs {
		if id = strings.TrimSpace(id); id != "" {
			triggers[id] = true
		}
	}
	remaining := maxRunes
	chosen := make(map[int]Excerpt, len(turns))
	include := func(i int) {
		if _, ok := chosen[i]; ok || remaining <= 0 {
			return
		}
		turn := turns[i]
		text := strings.TrimSpace(turn.Text)
		overhead := utf8.RuneCountInString(turn.Author) + utf8.RuneCountInString(turn.Role) + 8
		length := utf8.RuneCountInString(text)
		limit := min(perMessage, remaining-overhead)
		truncated := length > limit
		if truncated {
			if limit < minExcerptRunes {
				return
			}
			text = string([]rune(text)[:limit])
			length = limit
		}
		remaining -= overhead + length
		turn.Text = text
		chosen[i] = Excerpt{Turn: turn, Trigger: triggers[turn.ID], Truncated: truncated}
	}
	for i := len(turns) - 1; i >= 0; i-- {
		if turns[i].Role == "member" {
			include(i)
			break
		}
	}
	for i := len(turns) - 1; i >= 0; i-- {
		if triggers[turns[i].ID] {
			include(i)
		}
	}
	for i := len(turns) - 1; i >= 0; i-- {
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

// Render writes the transcript oldest first, marking triggers, cut-down
// messages and the gaps left by omitted ones. Cut-down messages carry their
// id, and omitted ranges carry their time span and ids, so the agent can read
// them in full with the commands listed at the top.
func (t Transcript) Render(issueID string) string {
	var truncated, omitted bool
	for _, e := range t.Excerpts {
		truncated = truncated || e.Truncated
		omitted = omitted || len(e.OmittedBefore) > 0
	}
	omitted = omitted || len(t.OmittedAfter) > 0

	var b strings.Builder
	if truncated {
		fmt.Fprintf(&b, "Messages marked [truncated id=<id>] are cut short. Read one in full with `multica issue comment list %s --thread <id> --tail 0 --output json`.\n", issueID)
	}
	if omitted {
		fmt.Fprintf(&b, "Omitted ranges list their time span. Read the messages after a time with `multica issue comment list %s --since <time> --output json`.\n", issueID)
	}
	if truncated || omitted {
		b.WriteString("\n")
	}
	for _, e := range t.Excerpts {
		writeOmitted(&b, e.OmittedBefore)
		label := e.Role
		if e.Trigger {
			label += ", triggered this reply"
		}
		text := e.Text
		if e.Truncated {
			text += " …[truncated id=" + e.ID + "]"
		}
		fmt.Fprintf(&b, "%s (%s): %s\n\n", e.Author, label, text)
	}
	writeOmitted(&b, t.OmittedAfter)
	return strings.TrimSpace(b.String())
}

func writeOmitted(b *strings.Builder, turns []Turn) {
	if len(turns) == 0 {
		return
	}
	fmt.Fprintf(b, "[%d message(s) omitted", len(turns))
	if first, last := turns[0].Time, turns[len(turns)-1].Time; first != "" && last != "" {
		fmt.Fprintf(b, ", %s – %s", first, last)
	}
	ids := make([]string, 0, min(len(turns), maxOmittedIDs))
	for _, turn := range turns[:min(len(turns), maxOmittedIDs)] {
		ids = append(ids, turn.ID)
	}
	fmt.Fprintf(b, ", ids: %s", strings.Join(ids, ", "))
	if extra := len(turns) - len(ids); extra > 0 {
		fmt.Fprintf(b, " +%d more", extra)
	}
	b.WriteString("]\n\n")
}
