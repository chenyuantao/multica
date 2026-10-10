package typesafe

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/shadowsocks/go-shadowsocks2/shadowaead"
	"github.com/shadowsocks/go-shadowsocks2/socks"
)

func TestClassifyProxy(t *testing.T) {
	cases := []struct {
		raw  string
		kind int
	}{
		{"http://127.0.0.1:7890", proxyKindHTTP},
		{"http://127.0.0.1:7890/", proxyKindHTTP},
		{"socks5://127.0.0.1:7891", proxyKindSOCKS},
		{"socks5h://user:pass@127.0.0.1:7891", proxyKindSOCKS},
		{"https://sub.example/path?token=1", proxyKindSubscription},
		{"http://sub.example/sub?token=1", proxyKindSubscription},
	}
	for _, tc := range cases {
		kind, u, err := classifyProxy(tc.raw)
		if err != nil {
			t.Fatalf("%s: %v", tc.raw, err)
		}
		if kind != tc.kind || u.Host == "" {
			t.Fatalf("%s: kind %d host %q", tc.raw, kind, u.Host)
		}
	}
	for _, raw := range []string{"", "ftp://example.com/a", "https://", "://nope"} {
		if _, _, err := classifyProxy(raw); !errors.Is(err, errProxyConfig) {
			t.Fatalf("%q err = %v", raw, err)
		}
	}
}

func TestEmptyProxyLeavesDefaultTransport(t *testing.T) {
	c := New(Config{APIKey: "secret"})
	if c.http.Transport != nil {
		t.Fatal("empty proxy URL replaced the default transport")
	}
	if c.proxyErr != nil {
		t.Fatal(c.proxyErr)
	}
}

func TestHTTPProxyTransport(t *testing.T) {
	c := New(Config{APIKey: "secret", ProxyURL: "http://127.0.0.1:7890"})
	tr, ok := c.http.Transport.(*http.Transport)
	if !ok || tr.Proxy == nil {
		t.Fatal("http proxy was not installed")
	}
	req, err := http.NewRequest(http.MethodGet, "https://api.typesafe.ai/v1/systemone", nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := tr.Proxy(req)
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != "http://127.0.0.1:7890" {
		t.Fatalf("proxy = %s", got)
	}
}

func TestInvalidProxyDoesNotDial(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer srv.Close()

	c := New(Config{APIKey: "secret", BaseURL: srv.URL, ProxyURL: "ftp://example.com/sub"})
	_, err := c.Evaluate(context.Background(), "x", map[string]any{"q": map[string]any{"type": "noul"}})
	if !errors.Is(err, errProxyConfig) {
		t.Fatalf("err = %v", err)
	}
	if called {
		t.Fatal("invalid proxy dialed TypeSafe")
	}

	disabled := New(Config{BaseURL: srv.URL, ProxyURL: "ftp://example.com/sub"})
	_, err = disabled.Evaluate(context.Background(), "x", map[string]any{"q": map[string]any{"type": "noul"}})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("disabled err = %v", err)
	}
}

func TestParseClashSubscription(t *testing.T) {
	body := []byte(`
mixed-port: 7890
proxies:
  - { name: vless-node, type: vless, server: 127.0.0.1, port: 443, uuid: abc }
  - { name: plugin-node, type: ss, server: 127.0.0.1, port: 443, cipher: aes-128-gcm, password: hidden, plugin: obfs }
  - { name: ok, type: ss, server: 127.0.0.1, port: 8388, cipher: chacha20-ietf-poly1305, password: secret }
  - { name: bad-cipher, type: ss, server: 127.0.0.1, port: 8388, cipher: rc4, password: secret }
`)
	nodes, err := parseSubscription(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].Name != "ok" || nodes[0].Password != "secret" {
		t.Fatalf("nodes = %+v", nodes)
	}

	wrapped := base64.StdEncoding.EncodeToString(body)
	nodes, err = parseSubscription([]byte(wrapped))
	if err != nil || len(nodes) != 1 || nodes[0].Name != "ok" {
		t.Fatalf("base64 nodes = %+v err %v", nodes, err)
	}
}

func TestParseSSURIList(t *testing.T) {
	user := base64.RawURLEncoding.EncodeToString([]byte("aes-128-gcm:test-pass"))
	legacy := base64.StdEncoding.EncodeToString([]byte("aes-256-gcm:other-pass@10.0.0.2:9443"))
	body := strings.Join([]string{
		fmt.Sprintf("ss://%s@127.0.0.1:8388#alpha", user),
		"ss://" + legacy + "#beta",
		fmt.Sprintf("ss://%s@127.0.0.1:8388?plugin=obfs-local#skip", user),
		"ss://rc4-md5:nope@127.0.0.1:1#skip-cipher",
	}, "\n")
	nodes, err := parseSubscription([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 {
		t.Fatalf("nodes = %+v", nodes)
	}
	if nodes[0].Name != "alpha" || nodes[0].Cipher != "aes-128-gcm" || nodes[0].Password != "test-pass" || nodes[0].Port != 8388 {
		t.Fatalf("first = %+v", nodes[0])
	}
	if nodes[1].Name != "beta" || nodes[1].Cipher != "aes-256-gcm" || nodes[1].Server != "10.0.0.2" || nodes[1].Port != 9443 {
		t.Fatalf("second = %+v", nodes[1])
	}
}

func TestSubscriptionParseErrorHidesSecret(t *testing.T) {
	_, err := parseSubscription([]byte("proxies: [ { password: super-secret-value,\n"))
	if err == nil || strings.Contains(err.Error(), "super-secret-value") {
		t.Fatalf("err = %v", err)
	}
}

func TestStripURLDropsCredential(t *testing.T) {
	err := stripURL(&url.Error{Op: "Get", URL: "https://sub.example/x?token=secret", Err: errors.New("dial failed")})
	if strings.Contains(err.Error(), "secret") || err.Error() != "dial failed" {
		t.Fatalf("err = %v", err)
	}
}

func TestEvaluateThroughClashSubscription(t *testing.T) {
	for _, cipherName := range []string{"chacha20-ietf-poly1305", "aes-128-gcm", "aes-256-gcm"} {
		t.Run(cipherName, func(t *testing.T) {
			assertSubscriptionTunnel(t, cipherName)
		})
	}
}

func assertSubscriptionTunnel(t *testing.T, cipherName string) {
	t.Helper()
	const password = "test-pass"
	var hits atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path != "/v1/systemone" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"answers":{"mode":{"type":"choice","choice":"parallel"}}}`)
	}))
	defer api.Close()

	ssLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ssLn.Close()
	go acceptShadowsocks(ssLn, cipherName, password)

	var fetches atomic.Int32
	sub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetches.Add(1)
		if r.UserAgent() != subscriptionUserAgent {
			t.Errorf("user agent = %q", r.UserAgent())
		}
		if r.URL.Path != "/sub" {
			http.NotFound(w, r)
			return
		}
		_, ssPort, _ := net.SplitHostPort(ssLn.Addr().String())
		// Port 1 refuses the connection, so the dialer must fall through to live.
		fmt.Fprintf(w, `
proxies:
  - { name: dead, type: ss, server: 127.0.0.1, port: 1, cipher: %s, password: %s }
  - { name: live, type: ss, server: 127.0.0.1, port: %s, cipher: %s, password: %s }
  - { name: vless-node, type: vless, server: 127.0.0.1, port: 443, uuid: abc }
`, cipherName, password, ssPort, cipherName, password)
	}))
	defer sub.Close()

	c := New(Config{
		APIKey:   "secret",
		BaseURL:  api.URL,
		ProxyURL: sub.URL + "/sub?token=not-logged",
	})
	ctx := context.Background()
	answers, err := c.Evaluate(ctx, map[string]any{"latest": "hi"}, map[string]any{
		"mode": map[string]string{"type": "choice"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if answers["mode"].Choice != "parallel" {
		t.Fatalf("answers = %+v", answers)
	}
	if _, err := c.Evaluate(ctx, "hi", map[string]any{"mode": map[string]string{"type": "choice"}}); err != nil {
		t.Fatal(err)
	}
	if fetches.Load() != 1 {
		t.Fatalf("subscription fetches = %d, want 1", fetches.Load())
	}
	if hits.Load() != 2 {
		t.Fatalf("api hits = %d", hits.Load())
	}
}

func TestOrderNodesStartsAtPreferred(t *testing.T) {
	nodes := []ssNode{{Name: "a"}, {Name: "b"}, {Name: "c"}}
	got := orderNodes(nodes, "b")
	if got[0].Name != "b" || got[1].Name != "c" || got[2].Name != "a" {
		t.Fatalf("order = %+v", got)
	}
	if orderNodes(nodes, "missing")[0].Name != "a" {
		t.Fatal("unknown preference changed the order")
	}
}

func TestSubscriptionWithoutNodeDoesNotDial(t *testing.T) {
	var hits atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
	}))
	defer api.Close()
	sub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "proxies:\n  - { name: vless-node, type: vless, server: 127.0.0.1, port: 443, uuid: abc }\n")
	}))
	defer sub.Close()
	c := New(Config{APIKey: "secret", BaseURL: api.URL, ProxyURL: sub.URL + "/sub"})
	_, err := c.Evaluate(context.Background(), "x", map[string]any{"q": map[string]any{"type": "noul"}})
	if !errors.Is(err, errProxyConfig) {
		t.Fatalf("err = %v", err)
	}
	if hits.Load() != 0 {
		t.Fatal("origin was dialed")
	}
}

func acceptShadowsocks(ln net.Listener, cipherName, password string) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go relayShadowsocks(conn, cipherName, password)
	}
}

func relayShadowsocks(conn net.Conn, cipherName, password string) {
	defer conn.Close()
	sc, err := plainShadowsocks(conn, cipherName, password)
	if err != nil {
		return
	}
	addr, err := socks.ReadAddr(sc)
	if err != nil {
		return
	}
	dst, err := net.Dial("tcp", addr.String())
	if err != nil {
		return
	}
	defer dst.Close()
	go func() {
		_, _ = io.Copy(dst, sc)
		dst.Close()
	}()
	_, _ = io.Copy(sc, dst)
}

// plainShadowsocks speaks the same AEAD stream as go-shadowsocks2 without the
// process-wide salt filter. The client under test uses core.PickCipher, which
// records salts; a second NewConn in this process would treat that salt as a replay.
type plainSS struct {
	net.Conn
	ciph shadowaead.Cipher
	r    io.Reader
	w    io.Writer
}

func plainShadowsocks(conn net.Conn, cipherName, password string) (net.Conn, error) {
	ciph, err := testCipher(cipherName, password)
	if err != nil {
		return nil, err
	}
	return &plainSS{Conn: conn, ciph: ciph}, nil
}

func (c *plainSS) Read(b []byte) (int, error) {
	if c.r == nil {
		salt := make([]byte, c.ciph.SaltSize())
		if _, err := io.ReadFull(c.Conn, salt); err != nil {
			return 0, err
		}
		aead, err := c.ciph.Decrypter(salt)
		if err != nil {
			return 0, err
		}
		c.r = shadowaead.NewReader(c.Conn, aead)
	}
	return c.r.Read(b)
}

func (c *plainSS) Write(b []byte) (int, error) {
	if c.w == nil {
		salt := make([]byte, c.ciph.SaltSize())
		if _, err := rand.Read(salt); err != nil {
			return 0, err
		}
		aead, err := c.ciph.Encrypter(salt)
		if err != nil {
			return 0, err
		}
		if _, err := c.Conn.Write(salt); err != nil {
			return 0, err
		}
		c.w = shadowaead.NewWriter(c.Conn, aead)
	}
	return c.w.Write(b)
}

func testCipher(name, password string) (shadowaead.Cipher, error) {
	var keyLen int
	switch strings.ToLower(name) {
	case "aes-128-gcm":
		keyLen = 16
	case "aes-256-gcm", "chacha20-ietf-poly1305":
		keyLen = 32
	default:
		return nil, errors.New("unsupported cipher")
	}
	key := testKDF(password, keyLen)
	if strings.EqualFold(name, "chacha20-ietf-poly1305") {
		return shadowaead.Chacha20Poly1305(key)
	}
	return shadowaead.AESGCM(key)
}

func testKDF(password string, keyLen int) []byte {
	var b, prev []byte
	h := md5.New()
	for len(b) < keyLen {
		h.Write(prev)
		h.Write([]byte(password))
		b = h.Sum(b)
		prev = b[len(b)-h.Size():]
		h.Reset()
	}
	return b[:keyLen]
}
