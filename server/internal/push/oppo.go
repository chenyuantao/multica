package push

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	PlatformOppo = "oppo"

	oppoAuthURL    = "https://api.push.oppomobile.com/server/v1/auth"
	oppoUnicastURL = "https://api.push.oppomobile.com/server/v1/message/notification/unicast"
	// Quick App notifications must use this fixed Android 8+ channel id.
	oppoQuickAppChannelID = "OPPO PUSH推送"
	maxOppoRegIDLength    = 256
	oppoAuthSkew          = 30 * time.Minute
)

// OppoConfig is the OPPO Push Open Platform credentials for a Quick App.
type OppoConfig struct {
	AppKey       string
	MasterSecret string
}

func (c OppoConfig) Enabled() bool {
	return c.AppKey != "" && c.MasterSecret != ""
}

func OppoConfigFromEnv() OppoConfig {
	return OppoConfig{
		AppKey:       strings.TrimSpace(os.Getenv("MULTICA_OPPO_PUSH_APP_KEY")),
		MasterSecret: strings.TrimSpace(os.Getenv("MULTICA_OPPO_PUSH_MASTER_SECRET")),
	}
}

// ValidateOppoRegID accepts the registration id returned by service.push.subscribe.
func ValidateOppoRegID(raw string) error {
	if raw == "" || len(raw) > maxOppoRegIDLength {
		return fmt.Errorf("invalid oppo registration id")
	}
	for _, r := range raw {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			continue
		}
		return fmt.Errorf("invalid oppo registration id")
	}
	return nil
}

type OppoSender struct {
	cfg        OppoConfig
	client     *http.Client
	authURL    string
	unicastURL string

	mu        sync.Mutex
	authToken string
	authUntil time.Time
}

func NewOppoSender(cfg OppoConfig) *OppoSender {
	return &OppoSender{
		cfg:        cfg,
		authURL:    oppoAuthURL,
		unicastURL: oppoUnicastURL,
		client: &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (s *OppoSender) Send(ctx context.Context, sub db.PushSubscription, msg Message) error {
	if err := ValidateOppoRegID(sub.Token); err != nil {
		return ErrSubscriptionGone
	}
	token, err := s.authTokenCached(ctx)
	if err != nil {
		return err
	}
	err = s.unicast(ctx, token, sub.Token, msg)
	if err == nil {
		return nil
	}
	if !isOppoAuthExpired(err) {
		return err
	}
	// Token is ~24h; drop the cache and retry once.
	s.mu.Lock()
	s.authToken = ""
	s.authUntil = time.Time{}
	s.mu.Unlock()
	token, err = s.authTokenCached(ctx)
	if err != nil {
		return err
	}
	return s.unicast(ctx, token, sub.Token, msg)
}

func (s *OppoSender) authTokenCached(ctx context.Context) (string, error) {
	s.mu.Lock()
	if s.authToken != "" && time.Now().Before(s.authUntil) {
		token := s.authToken
		s.mu.Unlock()
		return token, nil
	}
	s.mu.Unlock()

	token, createdAt, err := s.fetchAuth(ctx)
	if err != nil {
		return "", err
	}
	until := time.Now().Add(24 * time.Hour).Add(-oppoAuthSkew)
	if createdAt > 0 {
		until = time.UnixMilli(createdAt).Add(24 * time.Hour).Add(-oppoAuthSkew)
	}
	s.mu.Lock()
	s.authToken = token
	s.authUntil = until
	s.mu.Unlock()
	return token, nil
}

func (s *OppoSender) fetchAuth(ctx context.Context) (token string, createdAt int64, err error) {
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	sum := sha256.Sum256([]byte(s.cfg.AppKey + timestamp + s.cfg.MasterSecret))
	form := url.Values{
		"app_key":   {s.cfg.AppKey},
		"timestamp": {timestamp},
		"sign":      {hex.EncodeToString(sum[:])},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.authURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", 0, err
	}
	var parsed struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			AuthToken  string `json:"auth_token"`
			CreateTime string `json:"create_time"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", 0, fmt.Errorf("oppo auth: decode %w", err)
	}
	if parsed.Code != 0 || parsed.Data.AuthToken == "" {
		return "", 0, fmt.Errorf("oppo auth: code=%d message=%s", parsed.Code, parsed.Message)
	}
	if parsed.Data.CreateTime != "" {
		createdAt, _ = strconv.ParseInt(parsed.Data.CreateTime, 10, 64)
	}
	return parsed.Data.AuthToken, createdAt, nil
}

type oppoAPIError struct {
	code    int
	message string
}

func (e *oppoAPIError) Error() string {
	return fmt.Sprintf("oppo push: code=%d message=%s", e.code, e.message)
}

func isOppoAuthExpired(err error) bool {
	var apiErr *oppoAPIError
	if !asOppoAPIError(err, &apiErr) {
		return false
	}
	// OPPO documents auth_token expiry as a business error; treat common
	// auth failures as refreshable.
	return apiErr.code == 11 || apiErr.code == 33 ||
		strings.Contains(strings.ToLower(apiErr.message), "auth") ||
		strings.Contains(strings.ToLower(apiErr.message), "token")
}

func asOppoAPIError(err error, target **oppoAPIError) bool {
	if err == nil {
		return false
	}
	e, ok := err.(*oppoAPIError)
	if !ok {
		return false
	}
	*target = e
	return true
}

func (s *OppoSender) unicast(ctx context.Context, authToken, regID string, msg Message) error {
	title := msg.Title
	if title == "" {
		title = "Multica"
	}
	content := msg.Body
	if content == "" {
		content = title
	}
	payload := map[string]any{
		"target_type":  2,
		"target_value": regID,
		"notification": map[string]any{
			"title":             title,
			"content":           content,
			"channel_id":        oppoQuickAppChannelID,
			"click_action_type": 0,
			"off_line":          true,
			"off_line_ttl":      24 * 60 * 60,
			"action_parameters": map[string]string{
				"path": msg.URL,
			},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	form := url.Values{
		"auth_token": {authToken},
		"message":    {string(raw)},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.unicastURL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("auth_token", authToken)
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return err
	}
	var parsed struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return fmt.Errorf("oppo unicast: decode %w (status=%d)", err, resp.StatusCode)
	}
	switch parsed.Code {
	case 0:
		return nil
	case 10000:
		return ErrSubscriptionGone
	default:
		return &oppoAPIError{code: parsed.Code, message: parsed.Message}
	}
}
