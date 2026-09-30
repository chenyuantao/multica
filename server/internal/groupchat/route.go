// Package groupchat decides who replies in a group chat.
//
// A message that opens with one @ goes straight to that agent. Several named
// agents are kept as a set and only the order (parallel or sequential) is
// planned. A message that names nobody is planned in full: nobody, one agent,
// several independent agents, or several agents in order. @ inside quotes,
// fenced code, or inline code is not an address. A bare @Name that matches
// more than one member is rejected instead of picking one.
package groupchat

import (
	"regexp"
	"strings"
	"unicode"
)

// Participant is one person or agent in the chat.
type Participant struct {
	Type string // "member" or "agent"
	ID   string
	Name string
}

// Kind is how a message should be routed before any model call.
type Kind string

const (
	// KindAmbiguous means a bare @Name matches more than one member.
	KindAmbiguous Kind = "ambiguous"
	// KindDirect is one named agent. No planning call.
	KindDirect Kind = "direct"
	// KindNamed is two or more named agents. Planning chooses parallel or sequential.
	KindNamed Kind = "named"
	// KindPolicy is an unaddressed message. Planning chooses the mode and the agents.
	KindPolicy Kind = "policy"
	// KindNone is an address that does not include an agent, such as @ a person.
	KindNone Kind = "none"
)

// Address is the routing decision that can be made from the text alone.
type Address struct {
	Kind Kind
	// Name is set when Kind is KindAmbiguous.
	Name string
	// Agents are the named agents, in the order they appear.
	Agents []Participant
}

var (
	// Same id shape as util.MentionRe: a hex/dash run, not only a 36-char UUID.
	mentionLink = regexp.MustCompile(`\[@(.+?)\]\(mention://(agent|member)/([0-9a-fA-F-]+)\)`)
	fence       = regexp.MustCompile("(?s)```.*?```")
	inlineCode  = regexp.MustCompile("`[^`\n]*`")
)

type foundMention struct {
	start int
	name  string
	kind  string // agent, member, or "" when it is still a bare name
	id    string
	raw   string
}

// Route reads addresses out of content. quoted @ are ignored. participants
// resolve bare @Name; a name shared by two of them is KindAmbiguous.
func Route(content string, participants []Participant) Address {
	visible := stripQuoted(content)
	mentions := findMentions(visible)
	if amb, ok := ambiguousBare(mentions, participants); ok {
		return Address{Kind: KindAmbiguous, Name: amb}
	}
	// A single @ that opens the message is an address. One later @ is a
	// reference in the sentence, so the group policy still decides.
	if m, ok := leadingMention(visible, mentions); ok {
		if p, ok := resolveOne(m, participants); ok {
			if p.Type == "agent" {
				return Address{Kind: KindDirect, Agents: []Participant{p}}
			}
			return Address{Kind: KindNone}
		}
	}
	agents := resolveAgents(mentions, participants)
	switch len(agents) {
	case 0:
		if namesSomeone(mentions, participants) {
			return Address{Kind: KindNone}
		}
		return Address{Kind: KindPolicy}
	case 1:
		return Address{Kind: KindPolicy}
	default:
		return Address{Kind: KindNamed, Agents: agents}
	}
}

// leadingMention is the only @ in the message, and it is the first token.
func leadingMention(content string, mentions []foundMention) (foundMention, bool) {
	if len(mentions) != 1 {
		return foundMention{}, false
	}
	trimmed := strings.TrimLeftFunc(content, unicode.IsSpace)
	if mentions[0].start != len(content)-len(trimmed) {
		return foundMention{}, false
	}
	return mentions[0], true
}

func resolveOne(m foundMention, participants []Participant) (Participant, bool) {
	if m.id != "" {
		for _, p := range participants {
			if p.Type == m.kind && p.ID == m.id {
				return p, true
			}
		}
		return Participant{}, false
	}
	hits := matchName(m.name, participants)
	if len(hits) == 1 {
		return hits[0], true
	}
	return Participant{}, false
}

func stripQuoted(s string) string {
	s = fence.ReplaceAllString(s, " ")
	s = inlineCode.ReplaceAllString(s, " ")
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		trimmed := strings.TrimLeftFunc(line, unicode.IsSpace)
		if strings.HasPrefix(trimmed, ">") {
			b.WriteByte('\n')
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return b.String()
}

func findMentions(s string) []foundMention {
	var out []foundMention
	consumed := make([]bool, len(s))
	for _, m := range mentionLink.FindAllStringSubmatchIndex(s, -1) {
		out = append(out, foundMention{
			start: m[0],
			name:  s[m[2]:m[3]],
			kind:  s[m[4]:m[5]],
			id:    s[m[6]:m[7]],
			raw:   s[m[0]:m[1]],
		})
		for i := m[0]; i < m[1] && i < len(consumed); i++ {
			consumed[i] = true
		}
	}
	// Bare @Name, skipping ranges already taken by a mention link.
	for i := 0; i < len(s); i++ {
		if s[i] != '@' || (i < len(consumed) && consumed[i]) {
			continue
		}
		if i > 0 && !unicode.IsSpace(rune(s[i-1])) && s[i-1] != '\n' {
			continue
		}
		j := i + 1
		for j < len(s) && !unicode.IsSpace(rune(s[j])) && s[j] != '@' {
			j++
		}
		if j == i+1 {
			continue
		}
		name := strings.TrimRight(s[i+1:j], ".,;:!?")
		if name == "" || strings.EqualFold(name, "all") {
			continue
		}
		out = append(out, foundMention{start: i, name: name, raw: "@" + name})
	}
	return out
}

func ambiguousBare(mentions []foundMention, participants []Participant) (string, bool) {
	for _, m := range mentions {
		if m.id != "" {
			continue
		}
		if len(matchName(m.name, participants)) > 1 {
			return m.name, true
		}
	}
	return "", false
}

func matchName(name string, participants []Participant) []Participant {
	var hits []Participant
	for _, p := range participants {
		if strings.EqualFold(p.Name, name) {
			hits = append(hits, p)
		}
	}
	return hits
}

func resolveAgents(mentions []foundMention, participants []Participant) []Participant {
	seen := map[string]bool{}
	var agents []Participant
	add := func(p Participant) {
		if p.Type != "agent" || seen[p.ID] {
			return
		}
		seen[p.ID] = true
		agents = append(agents, p)
	}
	byID := map[string]Participant{}
	for _, p := range participants {
		byID[p.Type+":"+p.ID] = p
	}
	// Stable order: mention position, not map iteration.
	ordered := append([]foundMention(nil), mentions...)
	for i := 1; i < len(ordered); i++ {
		j := i
		for j > 0 && ordered[j].start < ordered[j-1].start {
			ordered[j], ordered[j-1] = ordered[j-1], ordered[j]
			j--
		}
	}
	for _, m := range ordered {
		if m.id != "" {
			if p, ok := byID[m.kind+":"+m.id]; ok {
				add(p)
			}
			continue
		}
		hits := matchName(m.name, participants)
		if len(hits) == 1 {
			add(hits[0])
		}
	}
	return agents
}

func namesSomeone(mentions []foundMention, participants []Participant) bool {
	byID := map[string]Participant{}
	for _, p := range participants {
		byID[p.Type+":"+p.ID] = p
	}
	for _, m := range mentions {
		if m.id != "" {
			if _, ok := byID[m.kind+":"+m.id]; ok {
				return true
			}
			continue
		}
		if len(matchName(m.name, participants)) == 1 {
			return true
		}
	}
	return false
}
