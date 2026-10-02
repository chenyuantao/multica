package groupchat

import (
	"strings"
	"testing"
)

func historyCard(json string) string {
	return "```" + chatHistoryLang + "\n" + json + "\n```"
}

func TestExpandChatHistoryRestoresTheRecord(t *testing.T) {
	nested := historyCard(`{"messages":[{"author_name":"Cy","content":"inside","created_at":"2026-09-30T13:02:00Z"}]}`)
	card := historyCard(`{"messages":[` +
		`{"author_name":"Ada","content":"ask [@Ada](mention:` + "\u200b" + `//agent/a1)\nship <v2>","created_at":"2026-09-30T13:00:00Z"},` +
		`{"author_name":"Bo","content":` + jsonString(nested) + `,"created_at":"2026-09-30T13:01:00Z"}]}`)

	got, ok := ExpandChatHistory(card)
	if !ok || !IsChatHistoryCard(card) {
		t.Fatal("expected a chat history card")
	}
	want := ChatHistoryHeading + "\n" +
		"Ada (2026-09-30T13:00:00Z): ask [@Ada](mention://agent/a1)\nship <v2>\n" +
		"Bo (2026-09-30T13:01:00Z): " + ChatHistoryHeading + "\n" +
		"Cy (2026-09-30T13:02:00Z): inside"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if strings.Contains(got, "\u200b") || strings.Contains(card, "mention://") {
		t.Fatal("mentions were not shielded in the card or not restored in the expansion")
	}
}

func TestIsChatHistoryCardRejectsOtherMessages(t *testing.T) {
	cases := []string{
		"hello",
		"hello\n" + historyCard(`{"messages":[{"author_name":"Ada","content":"x","created_at":"t"}]}`),
		historyCard(`{"messages":[]}`),
		historyCard(`{"messages":[{"author_name":1,"content":"x","created_at":"t"}]}`),
		"```" + chatHistoryLang + " {\"messages\":[]}",
	}
	for _, content := range cases {
		if IsChatHistoryCard(content) {
			t.Fatalf("accepted %q", content)
		}
	}
}

func jsonString(value string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range value {
		switch r {
		case '\\', '"':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\n':
			b.WriteString(`\n`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}
