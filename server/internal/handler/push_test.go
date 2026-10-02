package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

const testWebPushEndpoint = "https://web.push.apple.com/QGuQyavXutnMH-test"

func TestRegisterOppoPushSubscription(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	resetPushSubscriptions(t)
	t.Setenv("MULTICA_OPPO_PUSH_APP_KEY", "app")
	t.Setenv("MULTICA_OPPO_PUSH_MASTER_SECRET", "secret")

	const regID = "CN_b6bbd94b59cdb5df8391642c1509b7fe"
	testutil.Call(t, testHandler.RegisterPushSubscription,
		newRequest(http.MethodPost, "/api/push/subscriptions", map[string]any{
			"platform": "oppo",
			"token":    regID,
		}),
	).Want(http.StatusOK)
	if n := countPushSubscriptions(t); n != 1 {
		t.Fatalf("subscriptions = %d, want 1", n)
	}

	testutil.Call(t, testHandler.DeletePushSubscription,
		newRequest(http.MethodDelete, "/api/push/subscriptions", map[string]any{"platform": "oppo", "token": regID}),
	).Want(http.StatusNoContent)
}

func enableTestOppoPush(t *testing.T) {
	t.Helper()
	t.Setenv("MULTICA_OPPO_PUSH_APP_KEY", "app")
	t.Setenv("MULTICA_OPPO_PUSH_MASTER_SECRET", "secret")
}

func enableTestWebPush(t *testing.T) {
	t.Helper()
	t.Setenv("MULTICA_VAPID_PUBLIC_KEY", "test-public-key")
	t.Setenv("MULTICA_VAPID_PRIVATE_KEY", "test-private-key")
	t.Setenv("MULTICA_VAPID_SUBJECT", "ops@example.com")
}

func resetPushSubscriptions(t *testing.T) {
	t.Helper()
	clean := func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM push_subscription WHERE user_id = $1`, testUserID)
	}
	clean()
	t.Cleanup(clean)
}

func countPushSubscriptions(t *testing.T) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM push_subscription WHERE user_id = $1`, testUserID,
	).Scan(&n); err != nil {
		t.Fatalf("count push subscriptions: %v", err)
	}
	return n
}

func webPushSubscriptionBody(endpoint string) map[string]any {
	return map[string]any{
		"platform": "webpush",
		"token":    endpoint,
		"keys":     map[string]string{"p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", "auth": "tBHItJI5svbpez7KI4CCXg"},
	}
}

func TestPushConfigOmitsKeyWhenWebPushUnconfigured(t *testing.T) {
	t.Setenv("MULTICA_VAPID_PUBLIC_KEY", "")
	t.Setenv("MULTICA_VAPID_PRIVATE_KEY", "")
	t.Setenv("MULTICA_OPPO_PUSH_APP_KEY", "")
	t.Setenv("MULTICA_OPPO_PUSH_MASTER_SECRET", "")

	var out pushConfigResponse
	testutil.Call(t, testHandler.GetPushConfig, newRequest(http.MethodGet, "/api/push/config", nil)).
		Want(http.StatusOK).JSON(&out)
	if out.WebPushPublicKey != "" {
		t.Fatalf("web_push_public_key = %q, want empty", out.WebPushPublicKey)
	}
	if out.OppoPushEnabled {
		t.Fatal("oppo_push_enabled = true, want false")
	}

	enableTestWebPush(t)
	testutil.Call(t, testHandler.GetPushConfig, newRequest(http.MethodGet, "/api/push/config", nil)).
		Want(http.StatusOK).JSON(&out)
	if out.WebPushPublicKey != "test-public-key" {
		t.Fatalf("web_push_public_key = %q, want test-public-key", out.WebPushPublicKey)
	}

	t.Setenv("MULTICA_OPPO_PUSH_APP_KEY", "app")
	t.Setenv("MULTICA_OPPO_PUSH_MASTER_SECRET", "secret")
	testutil.Call(t, testHandler.GetPushConfig, newRequest(http.MethodGet, "/api/push/config", nil)).
		Want(http.StatusOK).JSON(&out)
	if !out.OppoPushEnabled {
		t.Fatal("oppo_push_enabled = false, want true")
	}
}

func TestRegisterPushSubscriptionIsIdempotentPerDevice(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	enableTestWebPush(t)
	resetPushSubscriptions(t)

	for range 2 {
		testutil.Call(t, testHandler.RegisterPushSubscription,
			newRequest(http.MethodPost, "/api/push/subscriptions", webPushSubscriptionBody(testWebPushEndpoint)),
		).Want(http.StatusOK)
	}
	if n := countPushSubscriptions(t); n != 1 {
		t.Fatalf("subscriptions = %d, want 1", n)
	}

	testutil.Call(t, testHandler.DeletePushSubscription,
		newRequest(http.MethodDelete, "/api/push/subscriptions", map[string]any{"platform": "webpush", "token": testWebPushEndpoint}),
	).Want(http.StatusNoContent)
	if n := countPushSubscriptions(t); n != 0 {
		t.Fatalf("subscriptions after delete = %d, want 0", n)
	}
}

func TestRegisterPushSubscriptionRejectsInvalidInput(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	resetPushSubscriptions(t)

	noKeys := webPushSubscriptionBody(testWebPushEndpoint)
	delete(noKeys, "keys")
	cases := []struct {
		name       string
		configured bool
		body       map[string]any
	}{
		{name: "web push not configured", body: webPushSubscriptionBody(testWebPushEndpoint)},
		{name: "endpoint outside push services", configured: true, body: webPushSubscriptionBody("https://169.254.169.254/latest")},
		{name: "missing encryption keys", configured: true, body: noKeys},
		{name: "unsupported platform", configured: true, body: map[string]any{"platform": "sms", "token": "x"}},
		{name: "empty token", configured: true, body: map[string]any{"platform": "webpush", "token": ""}},
		{name: "oppo push not configured", body: map[string]any{"platform": "oppo", "token": "CN_abc"}},
		{name: "oppo invalid reg id", configured: true, body: map[string]any{"platform": "oppo", "token": "bad!"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.configured {
				enableTestWebPush(t)
				enableTestOppoPush(t)
			} else {
				t.Setenv("MULTICA_VAPID_PUBLIC_KEY", "")
				t.Setenv("MULTICA_OPPO_PUSH_APP_KEY", "")
			}
			testutil.Call(t, testHandler.RegisterPushSubscription,
				newRequest(http.MethodPost, "/api/push/subscriptions", tc.body),
			).Want(http.StatusBadRequest)
		})
	}
	if n := countPushSubscriptions(t); n != 0 {
		t.Fatalf("subscriptions = %d, want 0", n)
	}
}
