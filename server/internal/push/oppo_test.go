package push

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestValidateOppoRegID(t *testing.T) {
	cases := []struct {
		raw  string
		want bool
	}{
		{raw: "CN_b6bbd94b59cdb5df8391642c1509b7fe", want: true},
		{raw: "OPPO_CN_abc-123", want: true},
		{raw: "", want: false},
		{raw: "bad id!", want: false},
		{raw: strings.Repeat("a", maxOppoRegIDLength+1), want: false},
	}
	for _, tc := range cases {
		err := ValidateOppoRegID(tc.raw)
		if (err == nil) != tc.want {
			t.Fatalf("ValidateOppoRegID(%q) err=%v, want ok=%v", tc.raw, err, tc.want)
		}
	}
}

func TestOppoConfigFromEnv(t *testing.T) {
	t.Setenv("MULTICA_OPPO_PUSH_APP_KEY", " key ")
	t.Setenv("MULTICA_OPPO_PUSH_MASTER_SECRET", " secret ")
	cfg := OppoConfigFromEnv()
	if !cfg.Enabled() || cfg.AppKey != "key" || cfg.MasterSecret != "secret" {
		t.Fatalf("config = %+v", cfg)
	}
	t.Setenv("MULTICA_OPPO_PUSH_MASTER_SECRET", "")
	if OppoConfigFromEnv().Enabled() {
		t.Fatal("expected disabled without master secret")
	}
}

func TestOppoSenderUnicast(t *testing.T) {
	var authCalls, sendCalls int
	var gotForm url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case strings.HasSuffix(r.URL.Path, "/auth"):
			authCalls++
			form, _ := url.ParseQuery(string(body))
			if form.Get("app_key") != "app" || form.Get("sign") == "" {
				t.Fatalf("auth form = %v", form)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{"auth_token": "tok", "create_time": "0"},
			})
		case strings.HasSuffix(r.URL.Path, "/unicast"):
			sendCalls++
			if r.Header.Get("auth_token") != "tok" {
				t.Fatalf("auth_token header = %q", r.Header.Get("auth_token"))
			}
			gotForm, _ = url.ParseQuery(string(body))
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	t.Cleanup(srv.Close)

	sender := NewOppoSender(OppoConfig{AppKey: "app", MasterSecret: "secret"})
	sender.authURL = srv.URL + "/server/v1/auth"
	sender.unicastURL = srv.URL + "/server/v1/message/notification/unicast"

	err := sender.Send(context.Background(), db.PushSubscription{
		ID:    util.MustParseUUID(testSubID),
		Token: "CN_abc123",
	}, Message{Title: "Hello", Body: "World", URL: "/acme/inbox"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if authCalls != 1 || sendCalls != 1 {
		t.Fatalf("auth=%d send=%d", authCalls, sendCalls)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(gotForm.Get("message")), &payload); err != nil {
		t.Fatalf("message JSON: %v (%q)", err, gotForm.Get("message"))
	}
	notification, _ := payload["notification"].(map[string]any)
	if notification["channel_id"] != oppoQuickAppChannelID {
		t.Fatalf("channel_id = %v", notification["channel_id"])
	}
	params, _ := notification["action_parameters"].(map[string]any)
	if params["path"] != "/acme/inbox" {
		t.Fatalf("path = %v", params["path"])
	}

	if err := sender.Send(context.Background(), db.PushSubscription{Token: "CN_abc123"}, Message{Title: "x", Body: "y"}); err != nil {
		t.Fatalf("second Send: %v", err)
	}
	if authCalls != 1 || sendCalls != 2 {
		t.Fatalf("after cache auth=%d send=%d", authCalls, sendCalls)
	}
}

func TestOppoSenderGoneOnInvalidRegID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/auth") {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{"auth_token": "tok"},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 10000, "message": "Invalid Registration_id"})
	}))
	t.Cleanup(srv.Close)

	sender := NewOppoSender(OppoConfig{AppKey: "app", MasterSecret: "secret"})
	sender.authURL = srv.URL + "/server/v1/auth"
	sender.unicastURL = srv.URL + "/server/v1/message/notification/unicast"

	err := sender.Send(context.Background(), db.PushSubscription{Token: "CN_abc"}, Message{Title: "t", Body: "b"})
	if err != ErrSubscriptionGone {
		t.Fatalf("err = %v, want ErrSubscriptionGone", err)
	}
}

func TestOppoSenderRejectsMalformedTokenWithoutRequest(t *testing.T) {
	sender := NewOppoSender(OppoConfig{AppKey: "app", MasterSecret: "secret"})
	err := sender.Send(context.Background(), db.PushSubscription{Token: "bad!"}, Message{Title: "t", Body: "b"})
	if err != ErrSubscriptionGone {
		t.Fatalf("err = %v, want ErrSubscriptionGone", err)
	}
}
