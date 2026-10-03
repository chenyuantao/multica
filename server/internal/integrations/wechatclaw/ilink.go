// Package wechatclaw talks to WeChat's iLink bot API: the QR login that binds
// a personal WeChat bot, the long poll that receives what the user sends it,
// and the replies, including the "typing" indicator, that go back.
package wechatclaw

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultBaseURL is the iLink API origin. A confirmed login may name another
// base URL for that bot, which then takes precedence.
var DefaultBaseURL = "https://ilinkai.weixin.qq.com"

const (
	longPollTimeout = 35 * time.Second
	sendTimeout     = 15 * time.Second
	maxResponseSize = 4 << 20
)

// Message types.
const (
	MessageTypeUser = 1
	MessageTypeBot  = 2
)

// Message states.
const (
	MessageStateNew    = 0
	MessageStateFinish = 2
)

// Item types. Only text starts work; the rest are ignored.
const (
	ItemTypeText  = 1
	ItemTypeImage = 2
	ItemTypeVoice = 3
	ItemTypeFile  = 4
	ItemTypeVideo = 5
)

// Typing states.
const (
	TypingStatusTyping = 1
	TypingStatusCancel = 2
)

// QR login statuses reported by get_qrcode_status.
const (
	QRStatusWait      = "wait"
	QRStatusScanned   = "scaned"
	QRStatusConfirmed = "confirmed"
	QRStatusExpired   = "expired"
)

// ErrCodeSessionExpired is the getupdates errcode that asks the poller to
// drop its cursor and start over.
const ErrCodeSessionExpired = -14

type QRCode struct {
	QRCode string `json:"qrcode"`
	// ImageContent is the URL the WeChat app opens; clients encode it as a QR.
	ImageContent string `json:"qrcode_img_content"`
}

type QRStatus struct {
	Status      string `json:"status"`
	BotToken    string `json:"bot_token"`
	ILinkBotID  string `json:"ilink_bot_id"`
	BaseURL     string `json:"baseurl"`
	ILinkUserID string `json:"ilink_user_id"`
}

type baseInfo struct {
	ChannelVersion string `json:"channel_version,omitempty"`
}

type getUpdatesRequest struct {
	GetUpdatesBuf string   `json:"get_updates_buf"`
	BaseInfo      baseInfo `json:"base_info"`
}

type Updates struct {
	Ret           int       `json:"ret"`
	ErrCode       int       `json:"errcode,omitempty"`
	ErrMsg        string    `json:"errmsg,omitempty"`
	Msgs          []Message `json:"msgs"`
	GetUpdatesBuf string    `json:"get_updates_buf"`
}

type Message struct {
	FromUserID   string        `json:"from_user_id"`
	ToUserID     string        `json:"to_user_id"`
	ClientID     string        `json:"client_id,omitempty"`
	MessageType  int           `json:"message_type"`
	MessageState int           `json:"message_state"`
	ItemList     []MessageItem `json:"item_list"`
	ContextToken string        `json:"context_token"`
}

type MessageItem struct {
	Type     int       `json:"type"`
	TextItem *TextItem `json:"text_item,omitempty"`
}

type TextItem struct {
	Text string `json:"text"`
}

// Text joins the message's text items. A message with no text (an image, a
// voice note, a file) returns "" and is not a trigger.
func (m Message) Text() string {
	var parts []string
	for _, item := range m.ItemList {
		if item.Type == ItemTypeText && item.TextItem != nil {
			if text := strings.TrimSpace(item.TextItem.Text); text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.Join(parts, "\n")
}

type sendMessageRequest struct {
	Msg      Message  `json:"msg"`
	BaseInfo baseInfo `json:"base_info"`
}

type retResponse struct {
	Ret    int    `json:"ret"`
	ErrMsg string `json:"errmsg,omitempty"`
}

type getConfigRequest struct {
	ILinkUserID  string   `json:"ilink_user_id"`
	ContextToken string   `json:"context_token,omitempty"`
	BaseInfo     baseInfo `json:"base_info"`
}

type getConfigResponse struct {
	Ret          int    `json:"ret"`
	ErrMsg       string `json:"errmsg,omitempty"`
	TypingTicket string `json:"typing_ticket,omitempty"`
}

type sendTypingRequest struct {
	ILinkUserID  string   `json:"ilink_user_id"`
	TypingTicket string   `json:"typing_ticket"`
	Status       int      `json:"status"`
	BaseInfo     baseInfo `json:"base_info"`
}

// Client is an iLink API client for one bot. The zero BotToken client can
// only run the QR login.
type Client struct {
	BaseURL  string
	BotToken string
	BotID    string
	HTTP     *http.Client
	uin      string
}

func NewClient(baseURL, botToken, botID string) *Client {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		BaseURL:  strings.TrimRight(baseURL, "/"),
		BotToken: botToken,
		BotID:    botID,
		HTTP:     &http.Client{},
		uin:      wechatUIN(),
	}
}

// FetchQRCode starts a login and returns the QR the user scans.
func (c *Client) FetchQRCode(ctx context.Context) (*QRCode, error) {
	var resp QRCode
	if err := c.get(ctx, "/ilink/bot/get_bot_qrcode?bot_type=3", &resp); err != nil {
		return nil, fmt.Errorf("fetch qrcode: %w", err)
	}
	if resp.QRCode == "" || resp.ImageContent == "" {
		return nil, errors.New("fetch qrcode: empty response")
	}
	return &resp, nil
}

// QRCodeStatus long-polls the login once. iLink holds the request while
// nothing changes, so callers bound ctx to what they can wait.
func (c *Client) QRCodeStatus(ctx context.Context, qrcode string) (*QRStatus, error) {
	var resp QRStatus
	if err := c.get(ctx, "/ilink/bot/get_qrcode_status?qrcode="+url.QueryEscape(qrcode), &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetUpdates long-polls for new messages after cursor.
func (c *Client) GetUpdates(ctx context.Context, cursor string) (*Updates, error) {
	ctx, cancel := context.WithTimeout(ctx, longPollTimeout+5*time.Second)
	defer cancel()
	var resp Updates
	if err := c.post(ctx, "/ilink/bot/getupdates", getUpdatesRequest{GetUpdatesBuf: cursor, BaseInfo: baseInfo{ChannelVersion: "1.0.0"}}, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// SendText sends a finished bot text message to the user.
func (c *Client) SendText(ctx context.Context, toUserID, contextToken, text string) error {
	ctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	req := sendMessageRequest{Msg: Message{
		FromUserID:   c.BotID,
		ToUserID:     toUserID,
		ClientID:     newClientID(),
		MessageType:  MessageTypeBot,
		MessageState: MessageStateFinish,
		ItemList:     []MessageItem{{Type: ItemTypeText, TextItem: &TextItem{Text: text}}},
		ContextToken: contextToken,
	}}
	var resp retResponse
	if err := c.post(ctx, "/ilink/bot/sendmessage", req, &resp); err != nil {
		return fmt.Errorf("send message: %w", err)
	}
	if resp.Ret != 0 {
		return fmt.Errorf("send message: ret=%d errmsg=%s", resp.Ret, resp.ErrMsg)
	}
	return nil
}

// TypingTicket fetches the ticket SendTyping needs for this user.
func (c *Client) TypingTicket(ctx context.Context, userID, contextToken string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var resp getConfigResponse
	if err := c.post(ctx, "/ilink/bot/getconfig", getConfigRequest{ILinkUserID: userID, ContextToken: contextToken}, &resp); err != nil {
		return "", fmt.Errorf("get config: %w", err)
	}
	if resp.TypingTicket == "" {
		return "", fmt.Errorf("get config: no typing_ticket (ret=%d errmsg=%s)", resp.Ret, resp.ErrMsg)
	}
	return resp.TypingTicket, nil
}

// SendTyping shows (TypingStatusTyping) or clears (TypingStatusCancel) the
// "typing" indicator in the user's chat with the bot.
func (c *Client) SendTyping(ctx context.Context, userID, ticket string, status int) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var resp retResponse
	if err := c.post(ctx, "/ilink/bot/sendtyping", sendTypingRequest{ILinkUserID: userID, TypingTicket: ticket, Status: status}, &resp); err != nil {
		return fmt.Errorf("send typing: %w", err)
	}
	if resp.Ret != 0 {
		return fmt.Errorf("send typing: ret=%d errmsg=%s", resp.Ret, resp.ErrMsg)
	}
	return nil
}

func (c *Client) post(ctx context.Context, path string, body, result any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("AuthorizationType", "ilink_bot_token")
	req.Header.Set("Authorization", "Bearer "+c.BotToken)
	req.Header.Set("X-WECHAT-UIN", c.uin)
	return c.do(req, result)
}

func (c *Client) get(ctx context.Context, path string, result any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return err
	}
	return c.do(req, result)
}

func (c *Client) do(req *http.Request, result any) error {
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("http %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	if err := json.Unmarshal(body, result); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

func wechatUIN() string {
	var n uint32
	_ = binary.Read(rand.Reader, binary.LittleEndian, &n)
	return base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("%d", n)))
}

func newClientID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "..."
}
