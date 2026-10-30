package imind

import (
	"context"
	"io"
	"net/http"
	"net/netip"
	"strings"
	"testing"
)

type clipTransport func(*http.Request) (*http.Response, error)

func (f clipTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestClipHTML(t *testing.T) {
	for _, tc := range []struct {
		name, contentType, body string
		status                  int
		wantError               bool
	}{
		{"html", "text/html; charset=utf-8", "<title>剪藏标题</title>", 200, false},
		{"xhtml", "application/xhtml+xml", "<title>Article</title>", 200, false},
		{"blocked", "text/html", "denied", 403, true},
		{"binary", "image/png", "binary", 200, true},
		{"bounded", "text/html", strings.Repeat("x", 1<<20), 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: clipTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method != "GET" || r.URL.RawQuery != "id=1" {
					t.Fatalf("wrong request: %v", r)
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": {tc.contentType}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})}
			got, err := ClipHTML(context.Background(), client, "https://example.com/article?id=1")
			if (err != nil) != tc.wantError {
				t.Fatalf("err=%v", err)
			}
			if !tc.wantError && got != tc.body[:min(len(tc.body), 128<<10)] {
				t.Fatal("HTML changed unexpectedly")
			}
		})
	}
	for _, raw := range []string{"file:///etc/passwd", "https://user:pass@example.com", "javascript:alert(1)"} {
		if _, err := ClipHTML(context.Background(), nil, raw); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestClipHTMLBlocksPrivateDestinations(t *testing.T) {
	for _, addr := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "100.100.100.200", "0.1.2.3", "240.0.0.1", "64:ff9b::7f00:1"} {
		if clipPublicAddress(netip.MustParseAddr(addr)) {
			t.Fatalf("allowed %s", addr)
		}
	}
	for _, addr := range []string{"8.8.8.8", "2606:4700:4700::1111"} {
		if !clipPublicAddress(netip.MustParseAddr(addr)) {
			t.Fatalf("blocked %s", addr)
		}
	}
	if _, err := ClipHTML(context.Background(), nil, "http://127.0.0.1:9"); err == nil {
		t.Fatal("allowed loopback fetch")
	}
	client := clipHTTPClient()
	req, _ := http.NewRequest("GET", "file:///etc/passwd", nil)
	if client.CheckRedirect(req, []*http.Request{{}}) == nil {
		t.Fatal("allowed non-HTTP redirect")
	}
	req, _ = http.NewRequest("GET", "https://example.com", nil)
	if client.CheckRedirect(req, make([]*http.Request, 5)) == nil {
		t.Fatal("allowed redirect loop")
	}
}
