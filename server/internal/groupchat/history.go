package groupchat

import (
	"encoding/json"
	"strings"
)

const (
	chatHistoryLang = "multica-chat-history"
	// ChatHistoryHeading opens a forwarded record once it has been expanded
	// into the transcript. The lines under it are the original messages.
	ChatHistoryHeading = "[chat history]"
	mentionGap         = "mention:\u200b//"
	maxHistoryDepth    = 8
)

// IsChatHistoryCard reports whether content is only a forwarded chat record.
// Such a message does not start a reply; the next message reads it as context.
func IsChatHistoryCard(content string) bool {
	_, ok := ExpandChatHistory(content)
	return ok
}

// ExpandChatHistory turns a forwarded record into the original messages, in
// order. Mentions inside the record are restored as text. Nested records are
// expanded the same way. A message that is not only that record returns false.
func ExpandChatHistory(content string) (string, bool) {
	return expandChatHistory(content, 0)
}

func expandChatHistory(content string, depth int) (string, bool) {
	if depth > maxHistoryDepth {
		return "", false
	}
	raw, ok := chatHistoryJSON(content)
	if !ok {
		return "", false
	}
	var payload struct {
		Messages []map[string]any `json:"messages"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil || len(payload.Messages) == 0 {
		return "", false
	}
	lines := make([]string, 0, len(payload.Messages))
	for _, item := range payload.Messages {
		msg, ok := historyMessageFrom(item)
		if !ok {
			continue
		}
		body := restoreMentions(msg.content)
		if nested, ok := expandChatHistory(body, depth+1); ok {
			body = nested
		}
		lines = append(lines, formatHistoryLine(msg.author, msg.created, body))
	}
	if len(lines) == 0 {
		return "", false
	}
	return ChatHistoryHeading + "\n" + strings.Join(lines, "\n"), true
}

type historyMessage struct {
	author  string
	content string
	created string
}

func historyMessageFrom(value map[string]any) (historyMessage, bool) {
	author, ok1 := value["author_name"].(string)
	content, ok2 := value["content"].(string)
	created, ok3 := value["created_at"].(string)
	if !ok1 || !ok2 || !ok3 {
		return historyMessage{}, false
	}
	return historyMessage{author: author, content: content, created: created}, true
}

func chatHistoryJSON(content string) (string, bool) {
	trimmed := strings.TrimSpace(content)
	open := "```" + chatHistoryLang
	if !strings.HasPrefix(trimmed, open) || !strings.HasSuffix(trimmed, "```") {
		return "", false
	}
	nl := strings.IndexByte(trimmed, '\n')
	if nl < 0 || nl+1 >= len(trimmed)-3 {
		return "", false
	}
	return strings.TrimSpace(trimmed[nl+1 : len(trimmed)-3]), true
}

func restoreMentions(content string) string {
	return strings.ReplaceAll(content, mentionGap, "mention://")
}

func formatHistoryLine(author, created, body string) string {
	header := strings.TrimSpace(author)
	if created != "" {
		if header != "" {
			header += " "
		}
		header += "(" + created + ")"
	}
	if header == "" {
		return body
	}
	if body == "" {
		return header
	}
	return header + ": " + body
}
