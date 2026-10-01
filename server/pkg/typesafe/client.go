// Package typesafe calls TypeSafe's System One API (Jev).
//
// Jev answers typed questions about a state. It does not generate chat text.
// Group-chat routing uses it to choose whether anyone replies, who, and
// whether those replies are independent or ordered, then in a later call
// which delivered messages that agent does not need. The API key comes from
// TYPESAFE_API_KEY. An empty key disables the client: Evaluate returns
// ErrNotConfigured and does not open a connection.
package typesafe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	DefaultBaseURL = "https://api.typesafe.ai"
	DefaultModel   = "jev-latest"
	evalPath       = "/v1/systemone"
)

// ErrNotConfigured is returned when TYPESAFE_API_KEY is empty.
var ErrNotConfigured = errors.New("typesafe: API key is not configured")

// Config is the deployment's Jev connection. Zero values are safe: Enabled
// is false and Evaluate does not dial.
type Config struct {
	APIKey  string
	BaseURL string
	Model   string
	// HTTPClient is optional. Tests inject a client bound to httptest.
	HTTPClient *http.Client
}

// Client evaluates a state against typed questions.
type Client struct {
	apiKey string
	base   string
	model  string
	http   *http.Client
}

// New returns a client. An empty API key yields a disabled client.
func New(cfg Config) *Client {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = DefaultModel
	}
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 20 * time.Second}
	}
	return &Client{
		apiKey: strings.TrimSpace(cfg.APIKey),
		base:   base,
		model:  model,
		http:   hc,
	}
}

// Enabled reports whether an API key is set.
func (c *Client) Enabled() bool {
	return c != nil && c.apiKey != ""
}

// Answer is one typed result. Unused fields stay at zero for the other types.
type Answer struct {
	Type          string             `json:"type"`
	Choice        string             `json:"choice,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
	Confidence    float64            `json:"confidence,omitempty"`
	Noul          float64            `json:"noul,omitempty"`
	Score         float64            `json:"score,omitempty"`
}

type evalRequest struct {
	State     any            `json:"state"`
	Model     string         `json:"model"`
	Questions map[string]any `json:"questions"`
}

type evalResponse struct {
	Model   string             `json:"model"`
	Answers map[string]Answer  `json:"answers"`
	Usage   map[string]float64 `json:"usage"`
}

// Evaluate posts one System One request. questions is the API's questions
// map; keys are chosen by the caller and come back on the answers.
func (c *Client) Evaluate(ctx context.Context, state any, questions map[string]any) (map[string]Answer, error) {
	if !c.Enabled() {
		return nil, ErrNotConfigured
	}
	if len(questions) == 0 {
		return nil, errors.New("typesafe: no questions")
	}
	body, err := json.Marshal(evalRequest{State: state, Model: c.model, Questions: questions})
	if err != nil {
		return nil, fmt.Errorf("typesafe: encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+evalPath, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("typesafe: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("typesafe: request: %w", err)
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("typesafe: read response: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("typesafe: %s: %s", res.Status, truncate(string(payload), 300))
	}
	var parsed evalResponse
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, fmt.Errorf("typesafe: decode response: %w", err)
	}
	if parsed.Answers == nil {
		return map[string]Answer{}, nil
	}
	return parsed.Answers, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
