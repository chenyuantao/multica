package realtime

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/redis/go-redis/v9"
)

// UserPresence answers whether a user currently holds at least one realtime
// connection on any node.
type UserPresence interface {
	IsUserOnline(ctx context.Context, userID string) bool
}

// LocalUserPresence is the single-node answer: the local hub is every
// connection there is.
type LocalUserPresence struct {
	Hub *Hub
}

func (p LocalUserPresence) IsUserOnline(_ context.Context, userID string) bool {
	return p.Hub.HasLocalSubscribers(ScopeUser, userID)
}

func PresenceKey(userID string) string {
	return fmt.Sprintf("ws:presence:user:%s", userID)
}

const (
	presenceTTL    = 90 * time.Second
	presencePeriod = 30 * time.Second
	presenceOpTTL  = 2 * time.Second
)

// RedisUserPresence records which nodes hold a connection for each user in a
// sorted set scored by expiry. Connect/disconnect update it immediately; the
// heartbeat refreshes every local user so a crashed node ages out within
// presenceTTL.
type RedisUserPresence struct {
	hub    *Hub
	rdb    redis.UniversalClient
	nodeID string
	now    func() time.Time
	// changes serialises connect/disconnect writes off the hub loop, which
	// fires the callbacks synchronously and must not wait on Redis.
	changes chan presenceChange
}

type presenceChange struct {
	userID string
	online bool
}

func NewRedisUserPresence(hub *Hub, rdb redis.UniversalClient) *RedisUserPresence {
	return &RedisUserPresence{
		hub:     hub,
		rdb:     rdb,
		nodeID:  ulid.Make().String(),
		now:     time.Now,
		changes: make(chan presenceChange, 1024),
	}
}

// Start installs the hub callbacks and runs the writer and heartbeat until
// ctx is done.
func (p *RedisUserPresence) Start(ctx context.Context) {
	p.hub.SetUserPresenceCallbacks(
		func(userID string) { p.enqueue(presenceChange{userID: userID, online: true}) },
		func(userID string) { p.enqueue(presenceChange{userID: userID, online: false}) },
	)
	go func() {
		ticker := time.NewTicker(presencePeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				p.hub.SetUserPresenceCallbacks(nil, nil)
				return
			case c := <-p.changes:
				if c.online {
					p.markOnline(c.userID)
				} else {
					p.markOffline(c.userID)
				}
			case <-ticker.C:
				p.refresh(ctx)
			}
		}
	}()
}

// enqueue drops the change when the writer is saturated; the next heartbeat
// re-adds online users and a missed removal ages out after presenceTTL.
func (p *RedisUserPresence) enqueue(c presenceChange) {
	select {
	case p.changes <- c:
	default:
		slog.Warn("presence: change queue full", "user_id", c.userID, "online", c.online)
	}
}

func (p *RedisUserPresence) IsUserOnline(ctx context.Context, userID string) bool {
	if p.hub.HasLocalSubscribers(ScopeUser, userID) {
		return true
	}
	opCtx, cancel := context.WithTimeout(ctx, presenceOpTTL)
	defer cancel()
	min := strconv.FormatInt(p.now().Unix(), 10)
	n, err := p.rdb.ZCount(opCtx, PresenceKey(userID), "("+min, "+inf").Result()
	if err != nil {
		// Reporting offline errs toward delivering a notification the user
		// may already have seen, rather than silently dropping one.
		slog.Warn("presence: lookup failed", "user_id", userID, "error", err)
		return false
	}
	return n > 0
}

func (p *RedisUserPresence) markOnline(userID string) {
	ctx, cancel := context.WithTimeout(context.Background(), presenceOpTTL)
	defer cancel()
	pipe := p.rdb.Pipeline()
	p.queueRefresh(ctx, pipe, userID)
	if _, err := pipe.Exec(ctx); err != nil {
		slog.Warn("presence: mark online failed", "user_id", userID, "error", err)
	}
}

func (p *RedisUserPresence) markOffline(userID string) {
	ctx, cancel := context.WithTimeout(context.Background(), presenceOpTTL)
	defer cancel()
	if err := p.rdb.ZRem(ctx, PresenceKey(userID), p.nodeID).Err(); err != nil {
		slog.Warn("presence: mark offline failed", "user_id", userID, "error", err)
	}
}

func (p *RedisUserPresence) refresh(ctx context.Context) {
	users := p.hub.LocalUserIDs()
	if len(users) == 0 {
		return
	}
	opCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	pipe := p.rdb.Pipeline()
	for _, userID := range users {
		p.queueRefresh(opCtx, pipe, userID)
	}
	if _, err := pipe.Exec(opCtx); err != nil {
		slog.Warn("presence: heartbeat failed", "users", len(users), "error", err)
	}
}

func (p *RedisUserPresence) queueRefresh(ctx context.Context, pipe redis.Pipeliner, userID string) {
	now := p.now()
	key := PresenceKey(userID)
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now.Add(presenceTTL).Unix()), Member: p.nodeID})
	pipe.ZRemRangeByScore(ctx, key, "-inf", strconv.FormatInt(now.Unix(), 10))
	pipe.Expire(ctx, key, presenceTTL)
}
