package wechatclaw

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMessageTextIgnoresNonTextItems(t *testing.T) {
	cases := []struct {
		name  string
		items []MessageItem
		want  string
	}{
		{"text", []MessageItem{{Type: ItemTypeText, TextItem: &TextItem{Text: " hi "}}}, "hi"},
		{"image only", []MessageItem{{Type: ItemTypeImage}}, ""},
		{"voice and file", []MessageItem{{Type: ItemTypeVoice}, {Type: ItemTypeFile}}, ""},
		{"blank text", []MessageItem{{Type: ItemTypeText, TextItem: &TextItem{Text: "  "}}}, ""},
		{"image with caption", []MessageItem{
			{Type: ItemTypeImage},
			{Type: ItemTypeText, TextItem: &TextItem{Text: "look"}},
		}, "look"},
		{"two text items", []MessageItem{
			{Type: ItemTypeText, TextItem: &TextItem{Text: "a"}},
			{Type: ItemTypeText, TextItem: &TextItem{Text: "b"}},
		}, "a\nb"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := (Message{ItemList: tc.items}).Text(); got != tc.want {
				t.Fatalf("Text() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSendTextPostsFinishedBotMessage(t *testing.T) {
	var got sendMessageRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/sendmessage" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.Header.Get("AuthorizationType") != "ilink_bot_token" || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("auth headers = %q / %q", r.Header.Get("AuthorizationType"), r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-WECHAT-UIN") == "" {
			t.Error("missing X-WECHAT-UIN")
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode: %v", err)
		}
		_, _ = w.Write([]byte(`{"ret":0}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL+"/", "tok", "bot@im.bot")
	if err := c.SendText(context.Background(), "user@im.wechat", "ctx-1", "hello"); err != nil {
		t.Fatalf("SendText: %v", err)
	}
	m := got.Msg
	if m.FromUserID != "bot@im.bot" || m.ToUserID != "user@im.wechat" || m.ContextToken != "ctx-1" {
		t.Fatalf("addressing = %+v", m)
	}
	if m.MessageType != MessageTypeBot || m.MessageState != MessageStateFinish || m.ClientID == "" {
		t.Fatalf("message meta = %+v", m)
	}
	if m.Text() != "hello" {
		t.Fatalf("text = %q", m.Text())
	}
}

func TestSendTextReportsNonZeroRet(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ret":-2,"errmsg":"bad context"}`))
	}))
	defer srv.Close()

	if err := NewClient(srv.URL, "tok", "bot").SendText(context.Background(), "u", "", "x"); err == nil {
		t.Fatal("SendText succeeded on ret=-2")
	}
}

func TestGetUpdatesSendsCursorAndDecodesMessages(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req getUpdatesRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.GetUpdatesBuf != "cur-1" {
			t.Errorf("cursor = %q", req.GetUpdatesBuf)
		}
		_, _ = w.Write([]byte(`{"ret":0,"get_updates_buf":"cur-2","msgs":[{"from_user_id":"u","message_type":1,"message_state":2,"context_token":"c","item_list":[{"type":1,"text_item":{"text":"hi"}}]}]}`))
	}))
	defer srv.Close()

	res, err := NewClient(srv.URL, "tok", "bot").GetUpdates(context.Background(), "cur-1")
	if err != nil {
		t.Fatalf("GetUpdates: %v", err)
	}
	if res.GetUpdatesBuf != "cur-2" || len(res.Msgs) != 1 || res.Msgs[0].Text() != "hi" || res.Msgs[0].ContextToken != "c" {
		t.Fatalf("updates = %+v", res)
	}
}

func TestFetchQRCodeRejectsEmptyResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"qrcode":""}`))
	}))
	defer srv.Close()

	if _, err := NewClient(srv.URL, "", "").FetchQRCode(context.Background()); err == nil {
		t.Fatal("FetchQRCode accepted an empty response")
	}
}

func TestTypingTicketRequiresTicket(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ilink/bot/getconfig" {
			_, _ = w.Write([]byte(`{"ret":0}`))
			return
		}
		t.Errorf("unexpected path %s", r.URL.Path)
	}))
	defer srv.Close()

	if _, err := NewClient(srv.URL, "tok", "bot").TypingTicket(context.Background(), "u", "c"); err == nil {
		t.Fatal("TypingTicket accepted a response without a ticket")
	}
}
