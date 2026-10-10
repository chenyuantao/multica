package typesafe

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	subscriptionCacheTTL = 10 * time.Minute
	subscriptionAttempts = 3
	subscriptionMaxBytes = 2 << 20
	// subscriptionUserAgent is required. This provider, and others like it,
	// close the connection when the client looks like a browser or the
	// default Go agent.
	subscriptionUserAgent = "clash.meta"
)

// subscriptionClient fetches the subscription itself. Proxy is nil so a
// machine-wide HTTP_PROXY cannot intercept a URL whose token is the credential.
var subscriptionClient = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		Proxy:               nil,
		DialContext:         (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second,
	},
}

type ssNode struct {
	Name     string
	Server   string
	Port     int
	Cipher   string
	Password string
}

type clashProxy struct {
	Name     string `yaml:"name"`
	Type     string `yaml:"type"`
	Server   string `yaml:"server"`
	Port     int    `yaml:"port"`
	Cipher   string `yaml:"cipher"`
	Password string `yaml:"password"`
	Plugin   string `yaml:"plugin"`
}

type subscriptionDialer struct {
	rawURL string

	mu     sync.Mutex
	nodes  []ssNode
	at     time.Time
	prefer string
}

func (d *subscriptionDialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	if network != "tcp" && network != "tcp4" && network != "tcp6" {
		return nil, fmt.Errorf("%w: dial %s is not supported", errProxyConfig, network)
	}
	conn, err := d.try(ctx, addr, false)
	if err == nil || errors.Is(err, errProxyConfig) {
		return conn, err
	}
	return d.try(ctx, addr, true)
}

func (d *subscriptionDialer) try(ctx context.Context, addr string, force bool) (net.Conn, error) {
	nodes, prefer, err := d.load(ctx, force)
	if err != nil {
		return nil, err
	}
	nodes = orderNodes(nodes, prefer)
	n := subscriptionAttempts
	if n > len(nodes) {
		n = len(nodes)
	}
	var last error
	for i := 0; i < n; i++ {
		conn, dialErr := dialShadowsocks(ctx, nodes[i], addr)
		if dialErr == nil {
			d.setPrefer(nodes[i].Name)
			return conn, nil
		}
		last = fmt.Errorf("typesafe: proxy node %s: %w", nodeLabel(nodes[i].Name), dialErr)
	}
	return nil, last
}

func (d *subscriptionDialer) load(ctx context.Context, force bool) ([]ssNode, string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !force && len(d.nodes) > 0 && time.Since(d.at) < subscriptionCacheTTL {
		return append([]ssNode(nil), d.nodes...), d.prefer, nil
	}
	nodes, err := fetchSubscription(ctx, d.rawURL)
	if err != nil {
		return nil, "", err
	}
	if len(nodes) == 0 {
		return nil, "", fmt.Errorf("%w: no shadowsocks node", errProxyConfig)
	}
	d.nodes = nodes
	d.at = time.Now()
	return append([]ssNode(nil), nodes...), d.prefer, nil
}

func (d *subscriptionDialer) setPrefer(name string) {
	d.mu.Lock()
	d.prefer = name
	d.mu.Unlock()
}

func orderNodes(nodes []ssNode, prefer string) []ssNode {
	if prefer == "" {
		return nodes
	}
	for i, node := range nodes {
		if node.Name == prefer {
			out := make([]ssNode, 0, len(nodes))
			out = append(out, nodes[i:]...)
			out = append(out, nodes[:i]...)
			return out
		}
	}
	return nodes
}

func nodeLabel(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "unnamed"
	}
	runes := []rune(name)
	if len(runes) > 80 {
		return string(runes[:80])
	}
	return name
}

func fetchSubscription(ctx context.Context, rawURL string) ([]ssNode, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid subscription url", errProxyConfig)
	}
	req.Header.Set("User-Agent", subscriptionUserAgent)
	res, err := subscriptionClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: fetch subscription: %v", errProxyConfig, stripURL(err))
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: subscription returned %s", errProxyConfig, res.Status)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, subscriptionMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: read subscription: %v", errProxyConfig, stripURL(err))
	}
	if len(body) > subscriptionMaxBytes {
		return nil, fmt.Errorf("%w: subscription is too large", errProxyConfig)
	}
	nodes, err := parseSubscription(body)
	if err != nil {
		return nil, err
	}
	return nodes, nil
}

func parseSubscription(body []byte) ([]ssNode, error) {
	decoded := unwrapSubscription(body)
	if bytes.Contains(decoded, []byte("proxies:")) {
		return parseClashYAML(decoded)
	}
	if bytes.Contains(decoded, []byte("ss://")) {
		return parseSSURIs(decoded), nil
	}
	return nil, fmt.Errorf("%w: not clash yaml or a shadowsocks list", errProxyConfig)
}

func parseClashYAML(body []byte) ([]ssNode, error) {
	var cfg struct {
		Proxies []clashProxy `yaml:"proxies"`
	}
	if err := yaml.Unmarshal(body, &cfg); err != nil {
		// The yaml error quotes the input, which can contain a node password.
		return nil, fmt.Errorf("%w: not valid clash yaml", errProxyConfig)
	}
	return usableNodes(cfg.Proxies), nil
}

func usableNodes(proxies []clashProxy) []ssNode {
	out := make([]ssNode, 0, len(proxies))
	for _, p := range proxies {
		if !strings.EqualFold(p.Type, "ss") || strings.TrimSpace(p.Plugin) != "" {
			continue
		}
		if !supportedCipher(p.Cipher) || strings.TrimSpace(p.Server) == "" || p.Port <= 0 || p.Port > 65535 {
			continue
		}
		if p.Password == "" {
			continue
		}
		out = append(out, ssNode{
			Name:     p.Name,
			Server:   strings.TrimSpace(p.Server),
			Port:     p.Port,
			Cipher:   p.Cipher,
			Password: p.Password,
		})
	}
	return out
}

func supportedCipher(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305":
		return true
	default:
		return false
	}
}

func parseSSURIs(body []byte) []ssNode {
	var proxies []clashProxy
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		node, ok := parseSSURI(line)
		if !ok {
			continue
		}
		proxies = append(proxies, node)
	}
	return usableNodes(proxies)
}

func parseSSURI(line string) (clashProxy, bool) {
	if !strings.HasPrefix(line, "ss://") {
		return clashProxy{}, false
	}
	rest := strings.TrimPrefix(line, "ss://")
	var name string
	if i := strings.LastIndex(rest, "#"); i >= 0 {
		name, _ = url.PathUnescape(rest[i+1:])
		rest = rest[:i]
	}
	query := ""
	if i := strings.Index(rest, "?"); i >= 0 {
		query = rest[i+1:]
		rest = rest[:i]
	}
	if strings.Contains(query, "plugin=") {
		return clashProxy{}, false
	}
	method, password, host, port, ok := splitSSUser(rest)
	if !ok || !supportedCipher(method) {
		return clashProxy{}, false
	}
	portN, err := strconv.Atoi(port)
	if err != nil {
		return clashProxy{}, false
	}
	return clashProxy{
		Name:     name,
		Type:     "ss",
		Server:   host,
		Port:     portN,
		Cipher:   method,
		Password: password,
	}, true
}

func splitSSUser(rest string) (method, password, host, port string, ok bool) {
	if user, hostport, found := strings.Cut(rest, "@"); found {
		method, password, ok = decodeMethodPassword(user)
		if !ok {
			return "", "", "", "", false
		}
		host, port, err := net.SplitHostPort(hostport)
		if err != nil {
			return "", "", "", "", false
		}
		return method, password, host, port, true
	}
	decoded, ok := decodeBase64(rest)
	if !ok {
		return "", "", "", "", false
	}
	user, hostport, found := strings.Cut(string(decoded), "@")
	if !found {
		return "", "", "", "", false
	}
	method, password, ok = strings.Cut(user, ":")
	if !ok || method == "" || password == "" {
		return "", "", "", "", false
	}
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		return "", "", "", "", false
	}
	return method, password, host, port, true
}

func decodeMethodPassword(user string) (string, string, bool) {
	if method, password, ok := strings.Cut(user, ":"); ok && method != "" && password != "" {
		return method, password, true
	}
	decoded, ok := decodeBase64(user)
	if !ok {
		return "", "", false
	}
	method, password, found := strings.Cut(string(decoded), ":")
	if !found || method == "" || password == "" {
		return "", "", false
	}
	return method, password, true
}

func unwrapSubscription(body []byte) []byte {
	trim := bytes.TrimSpace(body)
	if looksLikeSubscription(trim) {
		return trim
	}
	decoded, ok := decodeBase64(string(trim))
	if !ok {
		return trim
	}
	decoded = bytes.TrimSpace(decoded)
	if looksLikeSubscription(decoded) {
		return decoded
	}
	return trim
}

func looksLikeSubscription(body []byte) bool {
	return bytes.Contains(body, []byte("proxies:")) || bytes.Contains(body, []byte("ss://"))
}

func decodeBase64(s string) ([]byte, bool) {
	s = strings.Map(func(r rune) rune {
		switch r {
		case '\n', '\r', '\t', ' ':
			return -1
		default:
			return r
		}
	}, s)
	if s == "" {
		return nil, false
	}
	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, true
	}
	if b, err := base64.URLEncoding.DecodeString(s); err == nil {
		return b, true
	}
	return nil, false
}

func stripURL(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr.Err != nil {
		return urlErr.Err
	}
	return err
}
