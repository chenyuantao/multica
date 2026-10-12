package groupchat

import (
	"strings"
	"time"
	"unicode"
)

// ReuseLimit is how many existing chats Mika is shown when deciding whether
// to continue one. The score, not the title alone, decides the order.
const ReuseLimit = 5

// ReuseChat is one group the person already belongs to.
type ReuseChat struct {
	ID           string
	Title        string
	Status       string
	LastMessage  string
	LastActivity time.Time
}

// ReuseScore is one ranked candidate. Recommend is true when the last
// message or an unfinished recent title is close enough to continue.
type ReuseScore struct {
	ReuseChat
	Unfinished float64
	Recency    float64
	Message    float64
	Title      float64
	Score      float64
	Recommend  bool
}

// RankReuse orders chats for continuing an instruction. Unfinished work,
// a recent last message, and a last message that resembles the instruction
// all raise a chat. Title resemblance is a weak signal and cannot win alone.
// Direct chats and reminders are excluded by the caller.
func RankReuse(query string, chats []ReuseChat, now time.Time) []ReuseScore {
	out := make([]ReuseScore, 0, len(chats))
	for _, chat := range chats {
		scored := scoreReuse(query, chat, now)
		out = append(out, scored)
	}
	for i := 1; i < len(out); i++ {
		j := i
		for j > 0 && reuseLess(out[j], out[j-1]) {
			out[j], out[j-1] = out[j-1], out[j]
			j--
		}
	}
	if len(out) > ReuseLimit {
		out = out[:ReuseLimit]
	}
	return out
}

func scoreReuse(query string, chat ReuseChat, now time.Time) ReuseScore {
	scored := ReuseScore{ReuseChat: chat}
	if unfinishedStatus(chat.Status) {
		scored.Unfinished = 50
	}
	scored.Recency = recencyScore(chat.LastActivity, now)
	scored.Message = dice(query, chat.LastMessage) * 40
	scored.Title = dice(query, chat.Title) * 10
	scored.Score = scored.Unfinished + scored.Recency + scored.Message + scored.Title
	scored.Recommend = scored.Message >= 10 || (scored.Unfinished > 0 && (scored.Title >= 3.4 || (scored.Recency >= 30 && scored.Message >= 4.8)))
	return scored
}

func unfinishedStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "done", "cancelled", "canceled":
		return false
	default:
		return true
	}
}

func recencyScore(at, now time.Time) float64 {
	if at.IsZero() {
		return 0
	}
	age := now.Sub(at)
	if age < 0 {
		age = 0
	}
	switch {
	case age <= time.Hour:
		return 40
	case age <= 24*time.Hour:
		return 30
	case age <= 72*time.Hour:
		return 20
	case age <= 14*24*time.Hour:
		return 10
	default:
		return 0
	}
}

// reuseLess reports whether a should sort before b: higher score, then a
// more recent last message, then a stable id.
func reuseLess(a, b ReuseScore) bool {
	if a.Score != b.Score {
		return a.Score > b.Score
	}
	if !a.LastActivity.Equal(b.LastActivity) {
		return a.LastActivity.After(b.LastActivity)
	}
	return a.ID < b.ID
}

func dice(a, b string) float64 {
	left, right := bigrams(normalizeReuse(a)), bigrams(normalizeReuse(b))
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	inter := 0
	total := 0
	for gram, n := range left {
		total += n
		if m := right[gram]; m < n {
			inter += m
		} else {
			inter += n
		}
	}
	for _, n := range right {
		total += n
	}
	if total == 0 {
		return 0
	}
	return 2 * float64(inter) / float64(total)
}

func normalizeReuse(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func bigrams(s string) map[string]int {
	runes := []rune(s)
	if len(runes) < 2 {
		if len(runes) == 1 {
			return map[string]int{string(runes): 1}
		}
		return nil
	}
	out := make(map[string]int, len(runes))
	for i := 0; i < len(runes)-1; i++ {
		out[string(runes[i:i+2])]++
	}
	return out
}
