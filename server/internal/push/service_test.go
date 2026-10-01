package push

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	testUserID      = "11111111-1111-1111-1111-111111111111"
	testWorkspaceID = "22222222-2222-2222-2222-222222222222"
	testIssueID     = "33333333-3333-3333-3333-333333333333"
	testItemID      = "44444444-4444-4444-4444-444444444444"
	testSubID       = "55555555-5555-5555-5555-555555555555"
)

type fakeQuerier struct {
	subs    []db.PushSubscription
	prefs   []byte
	slug    string
	badges  []int64
	deleted []pgtype.UUID
}

func (f *fakeQuerier) ListPushSubscriptionsByUser(context.Context, pgtype.UUID) ([]db.PushSubscription, error) {
	return append([]db.PushSubscription(nil), f.subs...), nil
}

func (f *fakeQuerier) DeletePushSubscription(_ context.Context, id pgtype.UUID) error {
	f.deleted = append(f.deleted, id)
	return nil
}

func (f *fakeQuerier) GetWorkspace(context.Context, pgtype.UUID) (db.Workspace, error) {
	return db.Workspace{Slug: f.slug}, nil
}

func (f *fakeQuerier) GetNotificationPreference(context.Context, db.GetNotificationPreferenceParams) (db.NotificationPreference, error) {
	if f.prefs == nil {
		return db.NotificationPreference{}, pgx.ErrNoRows
	}
	return db.NotificationPreference{Preferences: f.prefs}, nil
}

func (f *fakeQuerier) CountUnreadInboxByWorkspace(context.Context, pgtype.UUID) ([]db.CountUnreadInboxByWorkspaceRow, error) {
	rows := make([]db.CountUnreadInboxByWorkspaceRow, 0, len(f.badges))
	for _, b := range f.badges {
		rows = append(rows, db.CountUnreadInboxByWorkspaceRow{BadgeCount: b})
	}
	return rows, nil
}

type fakeSender struct {
	err  error
	sent []Message
}

func (f *fakeSender) Send(_ context.Context, _ db.PushSubscription, msg Message) error {
	f.sent = append(f.sent, msg)
	return f.err
}

type fakePresence struct {
	online  bool
	lookups int
}

func (f *fakePresence) IsUserOnline(context.Context, string) bool {
	f.lookups++
	return f.online
}

func webPushSub() db.PushSubscription {
	return db.PushSubscription{ID: util.MustParseUUID(testSubID), Platform: PlatformWebPush, Token: "https://web.push.apple.com/x"}
}

func inboxEvent(recipientType string) events.Event {
	issueID := testIssueID
	body := "Alice mentioned you"
	return events.Event{
		Type: protocol.EventInboxNew,
		Payload: map[string]any{"item": map[string]any{
			"id":             testItemID,
			"workspace_id":   testWorkspaceID,
			"recipient_type": recipientType,
			"recipient_id":   testUserID,
			"issue_id":       &issueID,
			"title":          "MUL-1 Fix login",
			"body":           &body,
		}},
	}
}

func newTestService(q *fakeQuerier, presence *fakePresence, sender *fakeSender) *Service {
	s := NewService(q, presence, map[string]Sender{PlatformWebPush: sender}, nil)
	s.spawn = func(f func()) { f() }
	return s
}

func TestServiceDeliversInboxItemToOfflineUser(t *testing.T) {
	q := &fakeQuerier{subs: []db.PushSubscription{webPushSub()}, slug: "acme", badges: []int64{2, 3}}
	sender := &fakeSender{}
	newTestService(q, &fakePresence{}, sender).handleInboxNew(inboxEvent("member"))

	if len(sender.sent) != 1 {
		t.Fatalf("sent %d messages, want 1", len(sender.sent))
	}
	got := sender.sent[0]
	want := Message{
		Title: "MUL-1 Fix login",
		Body:  "Alice mentioned you",
		URL:   "/acme/inbox?issue=" + testIssueID,
		Tag:   testIssueID,
		Badge: 5,
	}
	if got != want {
		t.Fatalf("message = %+v, want %+v", got, want)
	}
}

func TestServiceSkipsDelivery(t *testing.T) {
	cases := []struct {
		name          string
		recipientType string
		online        bool
		prefs         string
	}{
		{name: "recipient is online", recipientType: "member", online: true},
		{name: "system notifications muted", recipientType: "member", prefs: `{"system_notifications":"muted"}`},
		{name: "agent recipient", recipientType: "agent"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := &fakeQuerier{subs: []db.PushSubscription{webPushSub()}, slug: "acme"}
			if tc.prefs != "" {
				q.prefs = []byte(tc.prefs)
			}
			sender := &fakeSender{}
			newTestService(q, &fakePresence{online: tc.online}, sender).handleInboxNew(inboxEvent(tc.recipientType))
			if len(sender.sent) != 0 {
				t.Fatalf("sent %d messages, want 0", len(sender.sent))
			}
		})
	}
}

func TestServiceSkipsPresenceLookupWithoutDeliverableDevice(t *testing.T) {
	q := &fakeQuerier{subs: []db.PushSubscription{{ID: util.MustParseUUID(testSubID), Platform: PlatformJPush, Token: "rid"}}}
	presence := &fakePresence{}
	sender := &fakeSender{}
	newTestService(q, presence, sender).handleInboxNew(inboxEvent("member"))

	if presence.lookups != 0 || len(sender.sent) != 0 {
		t.Fatalf("lookups=%d sent=%d, want neither for a platform without a sender", presence.lookups, len(sender.sent))
	}
}

func TestServiceDeletesGoneSubscription(t *testing.T) {
	q := &fakeQuerier{subs: []db.PushSubscription{webPushSub()}, slug: "acme"}
	newTestService(q, &fakePresence{}, &fakeSender{err: ErrSubscriptionGone}).handleInboxNew(inboxEvent("member"))

	if len(q.deleted) != 1 || util.UUIDToString(q.deleted[0]) != testSubID {
		t.Fatalf("deleted = %v, want [%s]", q.deleted, testSubID)
	}
}

func TestServiceKeepsSubscriptionOnTransientFailure(t *testing.T) {
	q := &fakeQuerier{subs: []db.PushSubscription{webPushSub()}, slug: "acme"}
	newTestService(q, &fakePresence{}, &fakeSender{err: errors.New("503")}).handleInboxNew(inboxEvent("member"))

	if len(q.deleted) != 0 {
		t.Fatalf("deleted = %v, want none", q.deleted)
	}
}

func TestNewServiceWithoutSendersIsNil(t *testing.T) {
	if NewService(&fakeQuerier{}, nil, nil, nil) != nil {
		t.Fatal("NewService without senders must return nil")
	}
}
