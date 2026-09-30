package groupchat

import "testing"

func TestAttachmentOnly(t *testing.T) {
	urls := []string{"https://cdn.example.com/a.png", "/api/attachments/f1/download"}
	cases := []struct {
		name    string
		content string
		want    bool
	}{
		{"image", "![a.png](https://cdn.example.com/a.png)", true},
		{"file card and image", "[spec \\[v2\\].pdf](/api/attachments/f1/download)\n\n![a.png](https://cdn.example.com/a.png)\n", true},
		{"text with attachment", "please review\n\n![a.png](https://cdn.example.com/a.png)", false},
		{"mention with attachment", "[@Dev](mention://agent/a1) ![a.png](https://cdn.example.com/a.png)", false},
		{"unrelated link", "[docs](https://example.com/docs)", false},
		{"plain text", "hello", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := AttachmentOnly(tc.content, urls); got != tc.want {
				t.Fatalf("AttachmentOnly(%q) = %v, want %v", tc.content, got, tc.want)
			}
		})
	}
	if AttachmentOnly("![a.png](https://cdn.example.com/a.png)", nil) {
		t.Fatal("content with no bound attachments is not attachment-only")
	}
}
