package imind

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html/charset"
)

// ClipHTML fetches static HTML only; no scripts, cookies, or subresources run.
func ClipHTML(ctx context.Context, client *http.Client, rawURL string) (string, error) {
	endpoint, err := url.Parse(rawURL)
	if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.Hostname() == "" || endpoint.User != nil {
		return "", errors.New("invalid clipping URL")
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if client == nil {
		client = clipHTTPClient()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("User-Agent", "Multica-iMind/1.0")
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", errors.New("clipping page unavailable")
	}
	contentType := res.Header.Get("Content-Type")
	if contentType != "" && !strings.HasPrefix(contentType, "text/html") && !strings.HasPrefix(contentType, "application/xhtml+xml") {
		return "", errors.New("clipping page is not HTML")
	}
	reader, err := charset.NewReader(io.LimitReader(res.Body, 512<<10), contentType)
	if err != nil {
		return "", err
	}
	body, err := io.ReadAll(io.LimitReader(reader, 128<<10))
	if err != nil {
		return "", err
	}
	return strings.ToValidUTF8(string(body), ""), nil
}

func clipPublicAddress(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() {
		return false
	}
	for _, prefix := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001::/23", "2001:db8::/32", "2002::/16", "64:ff9b::/96", "64:ff9b:1::/48"} {
		if netip.MustParsePrefix(prefix).Contains(addr) {
			return false
		}
	}
	return true
}

func clipHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableKeepAlives = true
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, addr := range addresses {
			if !clipPublicAddress(addr) {
				return nil, errors.New("clipping URL must resolve to public addresses")
			}
		}
		for _, addr := range addresses {
			conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(addr.String(), port))
			if err == nil {
				return conn, nil
			}
		}
		return nil, errors.New("clipping page connection failed")
	}
	return &http.Client{Transport: transport, Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || (req.URL.Scheme != "http" && req.URL.Scheme != "https") || req.URL.User != nil {
			return errors.New("invalid clipping redirect")
		}
		return nil
	}}
}
