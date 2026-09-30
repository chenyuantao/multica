package groupchat

import "strings"

// failureReasonLabels mirrors task_failure.reasons in
// packages/views/locales/zh-Hans/agents.json so a closed thinking bubble reads
// the same as the run's outcome elsewhere in the product.
var failureReasonLabels = map[string]string{
	"queued_expired":             "排队已过期",
	"runtime_offline":            "守护进程离线",
	"runtime_reconnect_timeout":  "守护进程未及时重新连接",
	"runtime_recovery":           "守护进程已重启",
	"timeout":                    "运行超时",
	"iteration_limit":            "达到迭代次数上限",
	"agent_blocked":              "等待人工输入",
	"api_invalid_request":        "模型 API 拒绝了请求",
	"skill_bundle_unavailable":   "无法下载智能体的 skill",
	"runtime_cli_timeout":        "本地运行时 CLI 超时",
	"environment_prepare_failed": "无法准备执行环境",
	"runtime_access_denied":      "该智能体无法在其私有运行时上运行，暂时无法回复。请将该运行时设为公开，或将智能体重新绑定/复制到其所有者可用的运行时。",
	"invalid_task_identity":      "运行身份不匹配",

	"agent_error.provider_auth_or_access":         "提供商认证失败",
	"agent_error.provider_quota_limit":            "提供商配额已用尽",
	"agent_error.provider_capacity_or_rate_limit": "受到提供商速率限制",
	"agent_error.provider_server_error":           "提供商服务器出错",
	"agent_error.provider_network":                "连接提供商时网络出错",

	"agent_error.process_failure":                "智能体进程崩溃",
	"agent_error.empty_or_unparseable_output":    "智能体未返回可用输出",
	"agent_error.agent_timeout":                  "智能体运行超时",
	"agent_error.context_overflow":               "上下文窗口已超限",
	"agent_error.missing_config":                 "缺少 API 密钥或配置",
	"agent_error.model_not_found_or_unavailable": "模型不可用",
	"agent_error.runtime_version_unsupported":    "运行器 CLI 版本不受支持",
	"agent_error.runtime_missing_executable":     "未安装运行器 CLI",
	"agent_error.unknown":                        "智能体执行出错",

	"agent_fallback_message":    "智能体返回了兜底消息",
	"codex_semantic_inactivity": "Codex 长时间没有语义进展",
	"codex_resume_oversized":    "会话过大，无法恢复",
	"idle_watchdog":             "智能体长时间无活动，运行已停止",
	"local_directory_error":     "本地目录出错",
	"cancelled":                 "系统已取消",

	"agent_error":    "智能体执行出错",
	"manual":         "用户取消",
	"user_cancelled": "用户取消",
}

// RunOutcome is how a run ended, as recorded on its task row.
type RunOutcome struct {
	Status          string
	FailureReason   string
	CancelledByType string
	CancelledByName string
}

// OutcomeMessage replaces ThinkingMessage when the run ends without a reply:
// its recorded reason, else who cancelled it, else UnfinishedMessage. A failure
// reason newer than this table keeps its raw code beside UnfinishedMessage.
func OutcomeMessage(o RunOutcome) string {
	switch o.Status {
	case "failed":
		if label, ok := failureReasonLabels[o.FailureReason]; ok {
			return label
		}
		if reason := strings.TrimSpace(o.FailureReason); reason != "" {
			return UnfinishedMessage + "（" + reason + "）"
		}
	case "cancelled":
		if label, ok := failureReasonLabels[o.FailureReason]; ok {
			return label
		}
		name := strings.TrimSpace(o.CancelledByName)
		if (o.CancelledByType == "member" || o.CancelledByType == "agent") && name != "" {
			return "已由 " + name + " 取消"
		}
		return "已由系统取消"
	}
	return UnfinishedMessage
}
