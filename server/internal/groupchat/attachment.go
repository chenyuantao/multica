package groupchat

import (
	"regexp"
	"strings"
)

var markdownLinkRe = regexp.MustCompile(`!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)`)

// AttachmentOnly reports whether content carries nothing but links to its own
// attachments. Such a message is context for the next one and does not start
// a reply. urls are every form an attachment link can take in the body.
func AttachmentOnly(content string, urls []string) bool {
	if len(urls) == 0 {
		return false
	}
	known := make(map[string]bool, len(urls))
	for _, u := range urls {
		if u != "" {
			known[u] = true
		}
	}
	found := false
	rest := markdownLinkRe.ReplaceAllStringFunc(content, func(link string) string {
		if !known[markdownLinkRe.FindStringSubmatch(link)[1]] {
			return link
		}
		found = true
		return ""
	})
	return found && strings.TrimSpace(rest) == ""
}
