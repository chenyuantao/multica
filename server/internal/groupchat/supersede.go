package groupchat

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"
)

const supersedeRunes = 2000

// SupersedeState is the third Jev request. An agent still has an unfinished
// request, and the user just sent another message.
type SupersedeState struct {
	Previous string `json:"previous"`
	Latest   string `json:"latest"`
}

// Supersedes reports whether the latest message supplements the unfinished
// request, so that request should be cancelled. A new question, a disabled
// evaluator, or any failure leaves the unfinished request running.
func Supersedes(ctx context.Context, ev Evaluator, previous, latest string) (bool, error) {
	if ev == nil || !ev.Enabled() {
		return false, nil
	}
	previous, latest = clipRunes(previous, supersedeRunes), clipRunes(latest, supersedeRunes)
	if previous == "" || latest == "" {
		return false, nil
	}
	answers, err := ev.Evaluate(ctx, SupersedeState{Previous: previous, Latest: latest}, map[string]any{
		"relation": map[string]any{
			"type":         "choice",
			"instructions": "用户在上一个请求还没完成时又发了一条消息。这条新消息是对上一个请求的补充，还是一个新问题？",
			"criteria": map[string]string{
				"追加":  "它补全或修正上一个请求。上一个未完成的请求应该取消，由包含这条补充的新请求来回答。",
				"新问题": "它是另一件事。上一个未完成的请求应该继续。",
			},
		},
	})
	if err != nil {
		return false, err
	}
	switch answers["relation"].Choice {
	case "追加":
		return true, nil
	case "新问题":
		return false, nil
	default:
		return false, fmt.Errorf("%w: relation answer %q", ErrUndecided, answers["relation"].Choice)
	}
}

func clipRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	runes := []rune(s)
	return string(runes[:n])
}
