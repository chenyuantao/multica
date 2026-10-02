package groupchat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/multica-ai/multica/server/pkg/typesafe"
)

const supersedeRunes = 2000

// supersedeConfidenceFloor is how sure Jev must be before an unfinished
// request is cancelled. A supplement is the rare case; anything less sure
// leaves the request running.
const supersedeConfidenceFloor = 0.8

// cancelledNoticeRunes caps the trigger line stored on the cancellation notice.
const cancelledNoticeRunes = 200

// cancelledFence is the comment fence the thread renders as a cancellation notice.
const cancelledFence = "multica-cancelled"

// SupersedeState is the third Jev request. An agent still has an unfinished
// request, and the user just sent another message.
type SupersedeState struct {
	Previous string `json:"previous"`
	Latest   string `json:"latest"`
}

// SupersedeExchange is the Jev call that decided to cancel: what was sent and
// what came back. Stored on the cancellation notice so the thread can show it.
type SupersedeExchange struct {
	Request  map[string]any             `json:"request"`
	Response map[string]typesafe.Answer `json:"response"`
}

// Supersedes reports whether the latest message supplements the unfinished
// request, so that request should be cancelled. Only a confident "追加"
// cancels. A new question, a low-confidence supplement, a disabled
// evaluator, or any failure leaves the unfinished request running. When it
// cancels, exchange is the Jev request and response from that call.
func Supersedes(ctx context.Context, ev Evaluator, previous, latest string) (bool, *SupersedeExchange, error) {
	if ev == nil || !ev.Enabled() {
		return false, nil, nil
	}
	previous, latest = clipRunes(previous, supersedeRunes), clipRunes(latest, supersedeRunes)
	if previous == "" || latest == "" {
		return false, nil, nil
	}
	state := SupersedeState{Previous: previous, Latest: latest}
	questions := map[string]any{
		"relation": map[string]any{
			"type": "choice",
			"instructions": "用户在上一个请求还没完成时又发了一条消息。默认不要取消上一个请求。" +
				"只有新消息离开上一条就读不通、本身无法单独回答、明显是半句补全或纠正时，才选「追加」。拿不准就选「新问题」。",
			"criteria": map[string]string{
				"追加": "新消息自己不构成一个能单独回答的请求，只是在补全、收窄或纠正上一个还没完成的请求。" +
					"例如上一条是「看一下部署」，这一条是「还有日志」。同一话题上另一句完整的要求、催促、换个说法，都不是追加。",
				"新问题": "它自己就能回答，或者只是和上一件相关。上一个未完成的请求继续跑完。",
			},
		},
	}
	answers, err := ev.Evaluate(ctx, state, questions)
	if err != nil {
		return false, nil, err
	}
	switch answers["relation"].Choice {
	case "追加":
		if answers["relation"].Confidence < supersedeConfidenceFloor {
			return false, nil, nil
		}
		return true, &SupersedeExchange{
			Request:  map[string]any{"state": state, "questions": questions},
			Response: answers,
		}, nil
	case "新问题":
		return false, nil, nil
	default:
		return false, nil, fmt.Errorf("%w: relation answer %q", ErrUndecided, answers["relation"].Choice)
	}
}

// CancelledNotice is the system comment posted after an unfinished request
// is actually cancelled. The thread renders the first line as an error and
// the quoted trigger, captured here, centered on the second line. When
// exchange is set, a details control can open the Jev request and response.
func CancelledNotice(trigger string, exchange *SupersedeExchange) string {
	payload := struct {
		Trigger  string                     `json:"trigger"`
		Request  map[string]any             `json:"request,omitempty"`
		Response map[string]typesafe.Answer `json:"response,omitempty"`
	}{Trigger: oneLine(trigger, cancelledNoticeRunes)}
	if exchange != nil {
		payload.Request = exchange.Request
		payload.Response = exchange.Response
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		raw = []byte(`{"trigger":""}`)
	}
	return "```" + cancelledFence + "\n" + string(raw) + "\n```"
}

func oneLine(s string, n int) string {
	return clipRunes(strings.Join(strings.Fields(s), " "), n)
}

func clipRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	runes := []rune(s)
	return string(runes[:n])
}
