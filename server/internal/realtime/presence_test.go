package realtime

import (
	"context"
	"errors"
	"testing"
	"time"

	redismock "github.com/go-redis/redismock/v9"
)

func TestHubUserPresenceCallbacksFireOnFirstAndLastConnection(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	online := make(chan string, 4)
	offline := make(chan string, 4)
	hub.SetUserPresenceCallbacks(
		func(userID string) { online <- userID },
		func(userID string) { offline <- userID },
	)
	presence := LocalUserPresence{Hub: hub}

	first := connectWS(t, server)
	second := connectWS(t, server)
	waitFor(t, "user online", func() bool { return presence.IsUserOnline(context.Background(), testUserID) })

	select {
	case got := <-online:
		if got != testUserID {
			t.Fatalf("online user = %q, want %q", got, testUserID)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for online callback")
	}

	first.Close()
	waitFor(t, "first client removed", func() bool { return totalClients(hub) == 1 })
	if !presence.IsUserOnline(context.Background(), testUserID) {
		t.Fatal("user with a remaining connection must stay online")
	}

	second.Close()
	select {
	case got := <-offline:
		if got != testUserID {
			t.Fatalf("offline user = %q, want %q", got, testUserID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for offline callback")
	}
	if presence.IsUserOnline(context.Background(), testUserID) {
		t.Fatal("user with no connections must be offline")
	}
	if len(online) != 0 || len(offline) != 0 {
		t.Fatalf("callbacks fired more than once: online=%d offline=%d", len(online), len(offline))
	}
}

func TestRedisUserPresenceIsUserOnline(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	cases := []struct {
		name  string
		count int64
		err   error
		want  bool
	}{
		{name: "live entry on another node", count: 1, want: true},
		{name: "no live entries", count: 0, want: false},
		{name: "redis error reads as offline", err: errors.New("down"), want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rdb, mock := redismock.NewClientMock()
			p := NewRedisUserPresence(NewHub(), rdb)
			p.now = func() time.Time { return now }

			expect := mock.ExpectZCount(PresenceKey("u1"), "(1700000000", "+inf")
			if tc.err != nil {
				expect.SetErr(tc.err)
			} else {
				expect.SetVal(tc.count)
			}

			if got := p.IsUserOnline(context.Background(), "u1"); got != tc.want {
				t.Fatalf("IsUserOnline = %v, want %v", got, tc.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRedisUserPresenceLocalConnectionSkipsRedis(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()
	conn := connectWS(t, server)
	defer conn.Close()

	rdb, mock := redismock.NewClientMock()
	p := NewRedisUserPresence(hub, rdb)
	waitFor(t, "local subscriber", func() bool { return hub.HasLocalSubscribers(ScopeUser, testUserID) })

	if !p.IsUserOnline(context.Background(), testUserID) {
		t.Fatal("a local connection must read as online")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
