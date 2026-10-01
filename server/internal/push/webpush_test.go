package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestValidateWebPushEndpoint(t *testing.T) {
	cases := []struct {
		endpoint string
		ok       bool
	}{
		{"https://web.push.apple.com/QGuQyavXutnMH", true},
		{"https://fcm.googleapis.com/fcm/send/abc", true},
		{"https://updates.push.services.mozilla.com/wpush/v2/abc", true},
		{"https://wns2-par02p.notify.windows.com/w/?token=abc", true},
		{"https://web.push.apple.com:443/abc", true},
		{"http://web.push.apple.com/abc", false},
		{"https://web.push.apple.com:8443/abc", false},
		{"https://user@web.push.apple.com/abc", false},
		{"https://evilpush.apple.com.attacker.test/abc", false},
		{"https://notpush.apple.com/abc", false},
		{"https://169.254.169.254/latest/meta-data", false},
		{"not a url", false},
	}
	for _, tc := range cases {
		err := ValidateWebPushEndpoint(tc.endpoint)
		if (err == nil) != tc.ok {
			t.Errorf("ValidateWebPushEndpoint(%q) err = %v, want ok=%v", tc.endpoint, err, tc.ok)
		}
	}
}

func TestWebPushConfigFromEnvSubject(t *testing.T) {
	cases := []struct {
		name, subject, appURL, want string
	}{
		{name: "explicit mailto is not double-prefixed", subject: "mailto:ops@example.com", want: "ops@example.com"},
		{name: "https app url fallback", appURL: "https://app.example.com/", want: "https://app.example.com"},
		{name: "http app url is not a valid subject", appURL: "http://localhost:3000", want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("MULTICA_VAPID_SUBJECT", tc.subject)
			t.Setenv("MULTICA_APP_URL", tc.appURL)
			t.Setenv("FRONTEND_ORIGIN", "")
			if got := WebPushConfigFromEnv().Subject; got != tc.want {
				t.Fatalf("Subject = %q, want %q", got, tc.want)
			}
		})
	}
}

func testSubscription(t *testing.T, endpoint string) db.PushSubscription {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	if _, err := rand.Read(auth); err != nil {
		t.Fatal(err)
	}
	return db.PushSubscription{
		Platform: PlatformWebPush,
		Token:    endpoint,
		P256dh:   base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(auth),
	}
}

func TestWebPushSenderMapsProviderStatus(t *testing.T) {
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		status  int
		wantErr error
		anyErr  bool
	}{
		{status: http.StatusCreated},
		{status: http.StatusGone, wantErr: ErrSubscriptionGone},
		{status: http.StatusNotFound, wantErr: ErrSubscriptionGone},
		{status: http.StatusTooManyRequests, anyErr: true},
	}
	for _, tc := range cases {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			var gotAuth string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotAuth = r.Header.Get("Authorization")
				w.WriteHeader(tc.status)
			}))
			defer srv.Close()

			sender := NewWebPushSender(WebPushConfig{PublicKey: pub, PrivateKey: priv, Subject: "ops@example.com"})
			err := sender.Send(context.Background(), testSubscription(t, srv.URL), Message{Title: "t", URL: "/acme/inbox"})

			switch {
			case tc.wantErr != nil:
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
			case tc.anyErr:
				if err == nil || errors.Is(err, ErrSubscriptionGone) {
					t.Fatalf("err = %v, want a transient error", err)
				}
			default:
				if err != nil {
					t.Fatalf("err = %v, want nil", err)
				}
			}
			if gotAuth == "" {
				t.Fatal("request carried no VAPID Authorization header")
			}
		})
	}
}
