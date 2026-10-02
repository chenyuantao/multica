package groupchat

import (
	"encoding/base64"
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	excerptNameMax = 200
	excerptPathMax = 1024
	excerptTextMax = 4000
)

// excerptPattern is the markdown link a chat message uses for a passage the
// sender selected in a knowledge note. The label is a preview; the payload is
// the passage.
var excerptPattern = regexp.MustCompile(`\[([^\]]*)\]\(doc-excerpt://([A-Za-z0-9_-]+)\)`)

type docExcerpt struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Text string `json:"text"`
}

func decodeExcerptPayload(payload string) (docExcerpt, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return docExcerpt{}, false
	}
	var excerpt docExcerpt
	if json.Unmarshal(raw, &excerpt) != nil {
		return docExcerpt{}, false
	}
	return normalizeExcerpt(excerpt)
}

func normalizeExcerpt(excerpt docExcerpt) (docExcerpt, bool) {
	name := clipExcerpt(cleanMeta(excerpt.Name), excerptNameMax)
	path := clipExcerpt(cleanMeta(excerpt.Path), excerptPathMax)
	text := strings.TrimSpace(strings.ReplaceAll(excerpt.Text, "\x00", ""))
	text = clipExcerpt(text, excerptTextMax)
	if name == "" || path == "" || text == "" {
		return docExcerpt{}, false
	}
	return docExcerpt{Name: name, Path: path, Text: text}, true
}

func cleanMeta(value string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(value, "\x00", "")), " ")
}

func clipExcerpt(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	return string([]rune(value)[:max])
}

func parseExcerptToken(token string) (docExcerpt, bool) {
	match := excerptPattern.FindStringSubmatch(token)
	if match == nil {
		return docExcerpt{}, false
	}
	return decodeExcerptPayload(match[2])
}

func hasDocExcerpt(text string) bool {
	for _, match := range excerptPattern.FindAllStringSubmatch(text, -1) {
		if _, ok := decodeExcerptPayload(match[2]); ok {
			return true
		}
	}
	return false
}

// readableExcerpts replaces passage links with the passage itself, so a reader
// that only sees the message text still knows which note it came from.
func readableExcerpts(text string) string {
	return excerptPattern.ReplaceAllStringFunc(text, func(token string) string {
		excerpt, ok := parseExcerptToken(token)
		if !ok {
			return token
		}
		return "「" + excerpt.Text + "」（" + excerpt.Name + " " + excerpt.Path + "）"
	})
}

// clipMessage shortens text to limit runes without cutting a passage link in
// half. A passage that is itself longer than the limit is kept whole when it
// is the first thing in the message.
func clipMessage(text string, limit int) (string, bool) {
	if limit < 0 {
		limit = 0
	}
	if utf8.RuneCountInString(text) <= limit {
		return text, false
	}
	var b strings.Builder
	used := 0
	rest := text
	for {
		loc := excerptPattern.FindStringIndex(rest)
		head := rest
		token := ""
		if loc != nil {
			head = rest[:loc[0]]
			token = rest[loc[0]:loc[1]]
			rest = rest[loc[1]:]
		} else {
			rest = ""
		}
		headRunes := []rune(head)
		if used+len(headRunes) > limit {
			b.WriteString(string(headRunes[:limit-used]))
			return b.String(), true
		}
		b.WriteString(head)
		used += len(headRunes)
		if token == "" {
			return b.String(), false
		}
		tokenRunes := utf8.RuneCountInString(token)
		if used+tokenRunes > limit {
			if used == 0 {
				b.WriteString(token)
				return b.String(), rest != ""
			}
			return b.String(), true
		}
		b.WriteString(token)
		used += tokenRunes
		if rest == "" {
			return b.String(), false
		}
	}
}

func writeMessageText(b *strings.Builder, text string) {
	rest := text
	for {
		loc := excerptPattern.FindStringSubmatchIndex(rest)
		if loc == nil {
			b.WriteString(escapeText(rest))
			return
		}
		b.WriteString(escapeText(rest[:loc[0]]))
		token := rest[loc[0]:loc[1]]
		if excerpt, ok := parseExcerptToken(token); ok {
			b.WriteString(`<ref role="excerpt" path="`)
			b.WriteString(escapeAttr(excerpt.Path))
			b.WriteString(`" name="`)
			b.WriteString(escapeAttr(excerpt.Name))
			b.WriteString(`">`)
			b.WriteString(escapeText(excerpt.Text))
			b.WriteString(`</ref>`)
		} else {
			b.WriteString(escapeText(token))
		}
		rest = rest[loc[1]:]
	}
}
