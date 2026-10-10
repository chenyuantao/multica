package typesafe

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/shadowsocks/go-shadowsocks2/core"
	"github.com/shadowsocks/go-shadowsocks2/socks"
	"golang.org/x/net/proxy"
)

const (
	proxyKindHTTP = iota
	proxyKindSOCKS
	proxyKindSubscription
)

// errProxyConfig is a proxy URL or subscription the caller cannot use.
// Node dial failures do not wrap it: those refresh the subscription once.
var errProxyConfig = errors.New("typesafe: proxy")

func newProxyTransport(raw string) (*http.Transport, error) {
	kind, u, err := classifyProxy(raw)
	if err != nil {
		return nil, err
	}
	switch kind {
	case proxyKindHTTP:
		return &http.Transport{Proxy: http.ProxyURL(u)}, nil
	case proxyKindSOCKS:
		return socksTransport(u)
	default:
		return &http.Transport{
			DialContext: (&subscriptionDialer{rawURL: raw}).DialContext,
		}, nil
	}
}

// classifyProxy distinguishes a local proxy from a Clash subscription.
// http://host:port (no path or query) is an HTTP CONNECT proxy, the usual
// Clash mixed port. socks5 and socks5h are SOCKS5. Any https URL, and an
// http URL that carries a path or query, is a subscription address.
func classifyProxy(raw string) (int, *url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Scheme == "" {
		return 0, nil, fmt.Errorf("%w: invalid url", errProxyConfig)
	}
	switch strings.ToLower(u.Scheme) {
	case "socks5", "socks5h":
		return proxyKindSOCKS, u, nil
	case "http":
		if (u.Path == "" || u.Path == "/") && u.RawQuery == "" && u.Fragment == "" {
			return proxyKindHTTP, u, nil
		}
		return proxyKindSubscription, u, nil
	case "https":
		return proxyKindSubscription, u, nil
	default:
		return 0, nil, fmt.Errorf("%w: unsupported scheme", errProxyConfig)
	}
}

func socksTransport(u *url.URL) (*http.Transport, error) {
	var auth *proxy.Auth
	if u.User != nil {
		password, _ := u.User.Password()
		auth = &proxy.Auth{User: u.User.Username(), Password: password}
	}
	dialer, err := proxy.SOCKS5("tcp", u.Host, auth, &net.Dialer{Timeout: 10 * time.Second})
	if err != nil {
		return nil, fmt.Errorf("%w: socks", errProxyConfig)
	}
	ctxDialer, ok := dialer.(proxy.ContextDialer)
	if !ok {
		return nil, fmt.Errorf("%w: socks", errProxyConfig)
	}
	return &http.Transport{DialContext: ctxDialer.DialContext}, nil
}

func dialShadowsocks(ctx context.Context, node ssNode, target string) (net.Conn, error) {
	ciph, err := core.PickCipher(node.Cipher, nil, node.Password)
	if err != nil {
		return nil, err
	}
	addr := socks.ParseAddr(target)
	if addr == nil {
		return nil, errors.New("bad target")
	}
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	raw, err := (&net.Dialer{}).DialContext(dialCtx, "tcp", net.JoinHostPort(node.Server, fmt.Sprintf("%d", node.Port)))
	if err != nil {
		return nil, stripURL(err)
	}
	ss := ciph.StreamConn(raw)
	if deadline, ok := dialCtx.Deadline(); ok {
		_ = raw.SetDeadline(deadline)
	}
	if _, err := ss.Write(addr); err != nil {
		raw.Close()
		return nil, err
	}
	_ = raw.SetDeadline(time.Time{})
	return ss, nil
}
