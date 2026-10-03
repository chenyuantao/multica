package wechatclaw

import "testing"

func TestMarkdownToPlainText(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "hello", "hello"},
		{"header and bold", "## Title\n**bold** and __also__", "Title\nbold and also"},
		{"mention keeps label", "ask [@Alice](mention://member/123)", "ask @Alice"},
		{"web link keeps url", "see [docs](https://example.com)", "see docs (https://example.com)"},
		{"bare web link", "[https://example.com](https://example.com)", "https://example.com"},
		{"image dropped", "before ![shot](https://x/y.png) after", "before  after"},
		{"code block", "```go\nfmt.Println(1)\n```", "fmt.Println(1)"},
		{"inline code", "run `make test`", "run make test"},
		{"list", "- one\n- two", "• one\n• two"},
		{"table", "| a | b |\n|---|---|\n| 1 | 2 |", "a  b\n\n1  2"},
		{"blank lines collapse", "a\n\n\n\nb", "a\n\nb"},
		{"quote and strike", "> ~~old~~ new", "old new"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := MarkdownToPlainText(tc.in); got != tc.want {
				t.Fatalf("MarkdownToPlainText(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
