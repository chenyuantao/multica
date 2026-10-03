package wechatclaw

import (
	"regexp"
	"strings"
)

var (
	reCodeBlock  = regexp.MustCompile("(?s)```[^\n]*\n?(.*?)```")
	reInlineCode = regexp.MustCompile("`([^`]+)`")
	reImage      = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	reLink       = regexp.MustCompile(`\[([^\]]+)\]\(([^)]*)\)`)
	reTableSep   = regexp.MustCompile(`(?m)^\|[\s:|\-]+\|$`)
	reTableRow   = regexp.MustCompile(`(?m)^\|(.+)\|$`)
	reHeader     = regexp.MustCompile(`(?m)^#{1,6}\s+`)
	reBold       = regexp.MustCompile(`\*\*(.+?)\*\*|__(.+?)__`)
	reStrike     = regexp.MustCompile(`~~(.+?)~~`)
	reBlockquote = regexp.MustCompile(`(?m)^>\s?`)
	reHR         = regexp.MustCompile(`(?m)^[-*_]{3,}\s*$`)
	reUL         = regexp.MustCompile(`(?m)^(\s*)[-*+]\s+`)
	reBlankLines = regexp.MustCompile(`\n{3,}`)
)

// MarkdownToPlainText renders an agent's Markdown reply as the plain text a
// WeChat chat shows. Mentions and other links keep their label; images are
// dropped because WeChat cannot show them inline.
func MarkdownToPlainText(text string) string {
	result := reCodeBlock.ReplaceAllStringFunc(text, func(match string) string {
		parts := reCodeBlock.FindStringSubmatch(match)
		if len(parts) > 1 {
			return strings.TrimSpace(parts[1])
		}
		return match
	})
	result = reImage.ReplaceAllString(result, "")
	result = reLink.ReplaceAllStringFunc(result, func(match string) string {
		parts := reLink.FindStringSubmatch(match)
		label, target := parts[1], parts[2]
		if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") {
			if label == target {
				return target
			}
			return label + " (" + target + ")"
		}
		return label
	})
	result = reTableSep.ReplaceAllString(result, "")
	result = reTableRow.ReplaceAllStringFunc(result, func(match string) string {
		parts := reTableRow.FindStringSubmatch(match)
		cells := strings.Split(parts[1], "|")
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		return strings.Join(cells, "  ")
	})
	result = reHeader.ReplaceAllString(result, "")
	result = reBold.ReplaceAllStringFunc(result, func(match string) string {
		parts := reBold.FindStringSubmatch(match)
		if parts[1] != "" {
			return parts[1]
		}
		return parts[2]
	})
	result = reStrike.ReplaceAllString(result, "$1")
	result = reBlockquote.ReplaceAllString(result, "")
	result = reHR.ReplaceAllString(result, "")
	result = reUL.ReplaceAllString(result, "${1}• ")
	result = reInlineCode.ReplaceAllString(result, "$1")
	result = reBlankLines.ReplaceAllString(result, "\n\n")
	return strings.TrimSpace(result)
}
