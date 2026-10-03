package wechatclaw

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	sweepInterval = 10 * time.Second
	// leaseTTL outlives one long poll (35s plus slack), so a healthy loop
	// renews it every iteration and a dead replica frees it within a minute.
	leaseTTL       = 90 * time.Second
	initialBackoff = 3 * time.Second
	maxBackoff     = time.Minute
)

// MessageHandler processes one message the user sent the bot. It runs on its
// own goroutine so a slow Ask AI never stalls the long poll.
type MessageHandler func(ctx context.Context, binding db.WechatClawBinding, client *Client, msg Message)

// Poller runs one long-poll loop per binding. Each loop holds the binding's
// lease, so across replicas exactly one consumes a bot's updates; a re-bind
// or unbind makes the old loop's renewal fail and it stops on its own.
type Poller struct {
	Queries *db.Queries
	Box     interface {
		Open([]byte) ([]byte, error)
	}
	Handle MessageHandler
	Logger *slog.Logger

	mu      sync.Mutex
	running map[string]bool
}

func (p *Poller) Run(ctx context.Context) {
	if p.Logger == nil {
		p.Logger = slog.Default()
	}
	p.running = map[string]bool{}
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()
	for {
		p.sweep(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (p *Poller) sweep(ctx context.Context) {
	bindings, err := p.Queries.ListWechatClawBindings(ctx)
	if err != nil {
		if ctx.Err() == nil {
			p.Logger.Warn("wechat claw: list bindings failed", "error", err)
		}
		return
	}
	for _, b := range bindings {
		key := util.UUIDToString(b.UserID) + "/" + b.IlinkBotID
		p.mu.Lock()
		if p.running[key] {
			p.mu.Unlock()
			continue
		}
		p.running[key] = true
		p.mu.Unlock()
		go func(b db.WechatClawBinding) {
			defer func() {
				p.mu.Lock()
				delete(p.running, key)
				p.mu.Unlock()
			}()
			p.runBinding(ctx, b)
		}(b)
	}
}

func (p *Poller) runBinding(ctx context.Context, b db.WechatClawBinding) {
	token := leaseToken()
	acquire := func() (db.WechatClawBinding, error) {
		return p.Queries.AcquireWechatClawLease(ctx, db.AcquireWechatClawLeaseParams{
			UserID:     b.UserID,
			IlinkBotID: b.IlinkBotID,
			LeaseToken: token,
			TtlSeconds: leaseTTL.Seconds(),
		})
	}
	held, err := acquire()
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) && ctx.Err() == nil {
			p.Logger.Warn("wechat claw: lease failed", "user_id", util.UUIDToString(b.UserID), "error", err)
		}
		return
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = p.Queries.ReleaseWechatClawLease(releaseCtx, db.ReleaseWechatClawLeaseParams{UserID: b.UserID, LeaseToken: token})
	}()

	client, err := ClientFor(p.Box, held)
	if err != nil {
		p.Logger.Warn("wechat claw: bot token unreadable", "user_id", util.UUIDToString(b.UserID), "error", err)
		return
	}
	logger := p.Logger.With("user_id", util.UUIDToString(b.UserID), "ilink_bot_id", b.IlinkBotID)
	logger.Info("wechat claw: polling")
	cursor := held.SyncCursor
	failures := 0
	for ctx.Err() == nil {
		updates, err := client.GetUpdates(ctx, cursor)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			failures++
			logger.Warn("wechat claw: getupdates failed", "error", err, "failures", failures)
			if !sleep(ctx, backoff(failures)) {
				return
			}
		} else {
			failures = 0
			switch {
			case updates.ErrCode == ErrCodeSessionExpired:
				logger.Info("wechat claw: session expired, resetting cursor")
				cursor = ""
				p.saveCursor(ctx, b, token, cursor)
				if !sleep(ctx, 5*time.Second) {
					return
				}
			case updates.Ret != 0 && updates.ErrCode != 0:
				logger.Warn("wechat claw: getupdates error", "ret", updates.Ret, "errcode", updates.ErrCode, "errmsg", updates.ErrMsg)
				if !sleep(ctx, initialBackoff) {
					return
				}
			default:
				if updates.GetUpdatesBuf != "" && updates.GetUpdatesBuf != cursor {
					cursor = updates.GetUpdatesBuf
					p.saveCursor(ctx, b, token, cursor)
				}
				for _, msg := range updates.Msgs {
					go p.Handle(ctx, held, client, msg)
				}
			}
		}
		renewed, err := acquire()
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				logger.Warn("wechat claw: lease renewal failed", "error", err)
			}
			logger.Info("wechat claw: stopped polling")
			return
		}
		held = renewed
	}
}

// ClientFor builds the bot client for a stored binding.
func ClientFor(box interface{ Open([]byte) ([]byte, error) }, b db.WechatClawBinding) (*Client, error) {
	token, err := OpenToken(box, b.BotTokenEncrypted)
	if err != nil {
		return nil, err
	}
	return NewClient(b.BaseUrl, token, b.IlinkBotID), nil
}

func (p *Poller) saveCursor(ctx context.Context, b db.WechatClawBinding, token, cursor string) {
	if err := p.Queries.SetWechatClawSyncCursor(ctx, db.SetWechatClawSyncCursorParams{
		UserID: b.UserID, LeaseToken: token, SyncCursor: cursor,
	}); err != nil && ctx.Err() == nil {
		p.Logger.Warn("wechat claw: cursor not saved", "user_id", util.UUIDToString(b.UserID), "error", err)
	}
}

// SealToken encrypts a bot token for the binding row.
func SealToken(box interface{ Seal([]byte) ([]byte, error) }, token string) (string, error) {
	sealed, err := box.Seal([]byte(token))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// OpenToken decrypts a bot token sealed by SealToken.
func OpenToken(box interface{ Open([]byte) ([]byte, error) }, sealed string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	plain, err := box.Open(raw)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func backoff(failures int) time.Duration {
	d := initialBackoff
	for i := 1; i < failures; i++ {
		d *= 2
		if d >= maxBackoff {
			return maxBackoff
		}
	}
	return d
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func leaseToken() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
