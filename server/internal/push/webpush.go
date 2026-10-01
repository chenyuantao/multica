package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	PlatformWebPush = "webpush"
	PlatformJPush   = "jpush"
)

// ErrSubscriptionGone means the provider no longer accepts deliveries for the
// device; the subscription should be deleted.
var ErrSubscriptionGone = errors.New("push subscription gone")

// webPushHostSuffixes are the browser push services a Web Push endpoint may
// point at. The server POSTs to whatever endpoint a client registers, so an
// open list would let any user aim server-side requests at arbitrary hosts.
var webPushHostSuffixes = []string{
	"push.apple.com",
	"fcm.googleapis.com",
	"push.services.mozilla.com",
	"notify.windows.com",
}

// ValidateWebPushEndpoint accepts only https URLs on a known browser push
// service.
func ValidateWebPushEndpoint(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" {
		return errors.New("endpoint must be an https URL")
	}
	if port := u.Port(); port != "" && port != "443" {
		return errors.New("endpoint must use the default https port")
	}
	host := strings.ToLower(u.Hostname())
	for _, suffix := range webPushHostSuffixes {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return nil
		}
	}
	return errors.New("endpoint is not a supported push service")
}

type WebPushConfig struct {
	PublicKey  string
	PrivateKey string
	// Subject is the VAPID contact (mailto: or https URL) push services use
	// to reach the operator.
	Subject string
}

func (c WebPushConfig) Enabled() bool {
	return c.PublicKey != "" && c.PrivateKey != "" && c.Subject != ""
}

// WebPushConfigFromEnv reads the VAPID key pair. The subject falls back to an
// https app URL so a deployment only has to provide the keys.
func WebPushConfigFromEnv() WebPushConfig {
	// webpush-go prepends "mailto:" to anything that is not an https URL.
	subject := strings.TrimPrefix(strings.TrimSpace(os.Getenv("MULTICA_VAPID_SUBJECT")), "mailto:")
	for _, env := range []string{"MULTICA_APP_URL", "FRONTEND_ORIGIN"} {
		if subject != "" {
			break
		}
		if appURL := strings.TrimRight(strings.TrimSpace(os.Getenv(env)), "/"); strings.HasPrefix(appURL, "https://") {
			subject = appURL
		}
	}
	return WebPushConfig{
		PublicKey:  strings.TrimSpace(os.Getenv("MULTICA_VAPID_PUBLIC_KEY")),
		PrivateKey: strings.TrimSpace(os.Getenv("MULTICA_VAPID_PRIVATE_KEY")),
		Subject:    subject,
	}
}

type WebPushSender struct {
	cfg    WebPushConfig
	client webpush.HTTPClient
}

func NewWebPushSender(cfg WebPushConfig) *WebPushSender {
	return &WebPushSender{
		cfg: cfg,
		client: &http.Client{
			Timeout: 10 * time.Second,
			// The endpoint host was allowlisted at registration; a redirect
			// would leave that list.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (s *WebPushSender) Send(ctx context.Context, sub db.PushSubscription, msg Message) error {
	payload, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Token,
		Keys:     webpush.Keys{Auth: sub.Auth, P256dh: sub.P256dh},
	}, &webpush.Options{
		HTTPClient:      s.client,
		Subscriber:      s.cfg.Subject,
		VAPIDPublicKey:  s.cfg.PublicKey,
		VAPIDPrivateKey: s.cfg.PrivateKey,
		TTL:             24 * 60 * 60,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrSubscriptionGone
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	default:
		return fmt.Errorf("web push: unexpected status %d", resp.StatusCode)
	}
}
