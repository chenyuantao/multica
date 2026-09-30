package groupchat

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestOutcomeMessage(t *testing.T) {
	cases := []struct {
		name string
		in   RunOutcome
		want string
	}{
		{"failed with reason", RunOutcome{Status: "failed", FailureReason: "agent_error.process_failure"}, "智能体进程崩溃"},
		{"failed with unknown reason", RunOutcome{Status: "failed", FailureReason: "something_new"}, "这次没有完成回复。（something_new）"},
		{"failed without reason", RunOutcome{Status: "failed"}, UnfinishedMessage},
		{"cancelled by member", RunOutcome{Status: "cancelled", CancelledByType: "member", CancelledByName: " Jiayuan "}, "已由 Jiayuan 取消"},
		{"cancelled by agent", RunOutcome{Status: "cancelled", CancelledByType: "agent", CancelledByName: "Reviewer"}, "已由 Reviewer 取消"},
		{"cancelled reason wins", RunOutcome{Status: "cancelled", FailureReason: "runtime_offline", CancelledByType: "member", CancelledByName: "Jiayuan"}, "守护进程离线"},
		{"cancelled nameless member", RunOutcome{Status: "cancelled", CancelledByType: "member"}, "已由系统取消"},
		{"cancelled by system", RunOutcome{Status: "cancelled", CancelledByType: "system"}, "已由系统取消"},
		{"completed without reply", RunOutcome{Status: "completed"}, UnfinishedMessage},
	}
	for _, c := range cases {
		if got := OutcomeMessage(c.in); got != c.want {
			t.Fatalf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestFailureReasonLabelsMatchWebCopy(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/views/locales/zh-Hans/agents.json")
	if err != nil {
		t.Fatalf("read zh-Hans agents locale: %v", err)
	}
	var locale struct {
		TaskFailure struct {
			Reasons map[string]string `json:"reasons"`
		} `json:"task_failure"`
	}
	if err := json.Unmarshal(raw, &locale); err != nil {
		t.Fatalf("parse zh-Hans agents locale: %v", err)
	}
	web := locale.TaskFailure.Reasons
	if len(web) != len(failureReasonLabels) {
		t.Fatalf("label count drifted: web %d, server %d", len(web), len(failureReasonLabels))
	}
	for reason, label := range failureReasonLabels {
		key := strings.ReplaceAll(reason, ".", "_")
		if web[key] != label {
			t.Fatalf("%s: web %q, server %q", reason, web[key], label)
		}
	}
}
