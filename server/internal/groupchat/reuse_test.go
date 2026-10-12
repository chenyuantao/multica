package groupchat

import (
	"testing"
	"time"
)

func TestRankReusePrefersUnfinishedRecentMatchingMessageOverTitle(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	query := "帮我解决待办页切换后不刷新的问题"
	chats := []ReuseChat{
		{ID: "title-only", Title: "待办页数据刷新修复", Status: "done", LastMessage: "明天开会", LastActivity: now.Add(-time.Hour)},
		{ID: "fresh-open", Title: "随便聊聊", Status: "todo", LastMessage: "待办页切换之后列表不刷新", LastActivity: now.Add(-30 * time.Minute)},
		{ID: "old-open", Title: "待办页", Status: "in_progress", LastMessage: "无关的内容", LastActivity: now.Add(-30 * 24 * time.Hour)},
	}
	got := RankReuse(query, chats, now)
	if len(got) != 3 {
		t.Fatalf("len = %d", len(got))
	}
	if got[0].ID != "fresh-open" {
		t.Fatalf("first = %s, want the unfinished chat whose last message matches", got[0].ID)
	}
	if !got[0].Recommend {
		t.Fatal("matching unfinished chat should be recommended")
	}
	if got[0].Message <= got[0].Title {
		t.Fatalf("message score %v should outweigh title score %v", got[0].Message, got[0].Title)
	}
}

func TestRankReuseCapsAtFive(t *testing.T) {
	now := time.Now()
	chats := make([]ReuseChat, 8)
	for i := range chats {
		chats[i] = ReuseChat{ID: string(rune('a' + i)), Status: "todo", LastActivity: now}
	}
	if len(RankReuse("x", chats, now)) != ReuseLimit {
		t.Fatalf("want %d", ReuseLimit)
	}
}
