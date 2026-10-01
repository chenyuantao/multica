// Package push delivers inbox notifications to registered devices while the
// recipient has no realtime connection open.
package push

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/realtime"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// Message is the JSON payload delivered to a device. The service worker and
// native shells render it as-is.
type Message struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	// URL is an app-relative path; clients resolve it against their origin.
	URL string `json:"url"`
	// Tag collapses repeated notifications for the same inbox group.
	Tag   string `json:"tag"`
	Badge int64  `json:"badge"`
}

type Sender interface {
	Send(ctx context.Context, sub db.PushSubscription, msg Message) error
}

type Querier interface {
	ListPushSubscriptionsByUser(ctx context.Context, userID pgtype.UUID) ([]db.PushSubscription, error)
	DeletePushSubscription(ctx context.Context, id pgtype.UUID) error
	GetWorkspace(ctx context.Context, id pgtype.UUID) (db.Workspace, error)
	GetNotificationPreference(ctx context.Context, arg db.GetNotificationPreferenceParams) (db.NotificationPreference, error)
	CountUnreadInboxByWorkspace(ctx context.Context, recipientID pgtype.UUID) ([]db.CountUnreadInboxByWorkspaceRow, error)
}

const (
	maxTitleRunes   = 120
	maxBodyRunes    = 240
	deliveryTimeout = 15 * time.Second
)

type Service struct {
	q        Querier
	presence realtime.UserPresence
	senders  map[string]Sender
	logger   *slog.Logger
	spawn    func(func())
}

// NewService returns nil when no platform has a sender, so callers can skip
// registration on deployments without push configured.
func NewService(q Querier, presence realtime.UserPresence, senders map[string]Sender, logger *slog.Logger) *Service {
	if len(senders) == 0 {
		return nil
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		q:        q,
		presence: presence,
		senders:  senders,
		logger:   logger,
		spawn:    func(f func()) { go f() },
	}
}

func (s *Service) Register(bus *events.Bus) {
	bus.Subscribe(protocol.EventInboxNew, s.handleInboxNew)
}

func (s *Service) handleInboxNew(e events.Event) {
	payload, ok := e.Payload.(map[string]any)
	if !ok {
		return
	}
	item, ok := payload["item"].(map[string]any)
	if !ok {
		return
	}
	if rt, _ := item["recipient_type"].(string); rt != "member" {
		return
	}
	recipientID, err := util.ParseUUID(stringField(item, "recipient_id"))
	if err != nil || !recipientID.Valid {
		return
	}
	workspaceID, err := util.ParseUUID(stringField(item, "workspace_id"))
	if err != nil || !workspaceID.Valid {
		return
	}
	// Bus delivery is synchronous and push providers are remote.
	s.spawn(func() {
		ctx, cancel := context.WithTimeout(context.Background(), deliveryTimeout)
		defer cancel()
		s.deliver(ctx, recipientID, workspaceID, item)
	})
}

func (s *Service) deliver(ctx context.Context, recipientID, workspaceID pgtype.UUID, item map[string]any) {
	subs, err := s.q.ListPushSubscriptionsByUser(ctx, recipientID)
	if err != nil {
		s.logger.WarnContext(ctx, "push: list subscriptions failed", "error", err, "recipient_id", util.UUIDToString(recipientID))
		return
	}
	targets := subs[:0]
	for _, sub := range subs {
		if s.senders[sub.Platform] != nil {
			targets = append(targets, sub)
		}
	}
	if len(targets) == 0 {
		return
	}
	// An open client already shows the item and its own banner.
	if s.presence != nil && s.presence.IsUserOnline(ctx, util.UUIDToString(recipientID)) {
		return
	}
	if s.systemNotificationsMuted(ctx, workspaceID, recipientID) {
		return
	}

	msg := s.buildMessage(ctx, recipientID, workspaceID, item)
	for _, sub := range targets {
		err := s.senders[sub.Platform].Send(ctx, sub, msg)
		switch {
		case err == nil:
		case errors.Is(err, ErrSubscriptionGone):
			if delErr := s.q.DeletePushSubscription(ctx, sub.ID); delErr != nil {
				s.logger.WarnContext(ctx, "push: delete gone subscription failed", "error", delErr, "subscription_id", util.UUIDToString(sub.ID))
			}
		default:
			s.logger.WarnContext(ctx, "push: send failed", "error", err, "platform", sub.Platform, "subscription_id", util.UUIDToString(sub.ID))
		}
	}
}

// systemNotificationsMuted mirrors the clients' banner gate: the source
// workspace's system_notifications preference. A failed lookup delivers.
func (s *Service) systemNotificationsMuted(ctx context.Context, workspaceID, userID pgtype.UUID) bool {
	pref, err := s.q.GetNotificationPreference(ctx, db.GetNotificationPreferenceParams{
		WorkspaceID: workspaceID,
		UserID:      userID,
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			s.logger.WarnContext(ctx, "push: preference lookup failed", "error", err)
		}
		return false
	}
	var prefs map[string]string
	if err := json.Unmarshal(pref.Preferences, &prefs); err != nil {
		return false
	}
	return prefs["system_notifications"] == "muted"
}

func (s *Service) buildMessage(ctx context.Context, recipientID, workspaceID pgtype.UUID, item map[string]any) Message {
	// Same selector the inbox page reads from ?issue=.
	issueKey := stringField(item, "issue_id")
	if issueKey == "" {
		issueKey = stringField(item, "id")
	}
	// "/inbox" resolves to the user's last workspace, the best guess when
	// the slug is unavailable.
	link := "/inbox"
	if ws, err := s.q.GetWorkspace(ctx, workspaceID); err == nil && ws.Slug != "" {
		link = "/" + url.PathEscape(ws.Slug) + "/inbox"
		if issueKey != "" {
			link += "?issue=" + url.QueryEscape(issueKey)
		}
	}

	var badge int64
	if rows, err := s.q.CountUnreadInboxByWorkspace(ctx, recipientID); err == nil {
		for _, row := range rows {
			badge += row.BadgeCount
		}
	}

	return Message{
		Title: truncateRunes(stringField(item, "title"), maxTitleRunes),
		Body:  truncateRunes(stringField(item, "body"), maxBodyRunes),
		URL:   link,
		Tag:   issueKey,
		Badge: badge,
	}
}

func stringField(m map[string]any, key string) string {
	switch v := m[key].(type) {
	case string:
		return v
	case *string:
		if v != nil {
			return *v
		}
	}
	return ""
}

func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max-1]) + "…"
}
