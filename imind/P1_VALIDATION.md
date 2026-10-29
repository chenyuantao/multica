# iMind P1 验收

环境：本地 `imind/docker-compose.yml` backend、当前受管理 checkout 的 PostgreSQL 数据库 `multica_multica_527`，专用工作区 `imind-validation`、共享 machine `imindhost`。没有生产写入。最终 backend 镜像为 `4d2dfbc253a9`，已重建启用，并在该镜像上重跑 8 项 P1 与 14 项既有契约通过。iOS 27.0 iPhone 18 Pro 与 Android 15 `imind_e2e_api35` 模拟器；不要求 iOS 16。

## 实现与证据

| P1 | 实现 | 验证范围 |
| --- | --- | --- |
| 拍照 / 选图 | 普通笔记、边录边记、录音详情共用入口；原生 picker；图片经认证 API、daemon 分块保存；相对 Markdown 与授权预览 | 两端注入 picker 后真实上传、撤销重做、保存、重开；取消、权限拒绝、上传失败保留原文由 Flutter 回归覆盖。模拟器注入不代表真机拍照。 |
| 验证码登录 | 独立本地 Docker OTP bridge；查询当前 checkout 容器内本次生成且未用、未过期的验证码；不预置 token、不输出验证码 | 两端实际 App 发送和提交验证码、错误码反馈、授权工作区/共享选择、笔记读写、退出与第二次登录；普通包新进程会话恢复另记下表。 |
| 原始录音 | ASR 同一 16 kHz mono PCM 流累计暂停前后音频，WAV 持久化；原生播放器、暂停/继续/结束、错误重试 | 两端麦克风录音、暂停续录、伴随笔记、保存重开；注入首次上传失败后原字节保留、重试同一笔记；持久 WAV 新进程播放；跨 512 KiB 块校验首尾及完整 hash。未声称实际听音通过。 |
| 文件 AI+ | 保存版本 + UUID / 共享根绑定常规群聊；幂等加入、评论、默认处理智能体、JEV、WebSocket、md 卡片、逐运行取消 | 服务端受控执行器覆盖默认配置和 JEV 回答、取消与其他群隔离；两端真实 HTTP/WS 覆盖同文件两用户、历史、消息增改删、隔离、后端重启重连、卡片授权打开；Web 可见相同历史和设置。 |

文件、媒体、API、权限与版本契约见 [CONTRACT.md](CONTRACT.md)。专用测试样例保留在共享根；不删除用户文件。

## 本轮设备记录

结果 JSON 与日志在 `outputs/imind/`；以下均是本地模拟器测试。原生设备测试入口使用同一文件锁串行构建，避免共享 Flutter 构建产物互相覆盖。

| 用例 | iOS | Android |
| --- | --- | --- |
| 图片持久化、撤销重做，原生 WAV 播放控制 | `ios-media-p1-results.json` | `android-media-p1-results.json` |
| 不同 App PID 读取已保存 WAV 并播放结束 | `ios-media-restore-p1-results.json` | `android-media-restore-p1-results.json` |
| 原生麦克风、暂停续录、保存失败保留与重试 | `ios-main-p1-results.json` | `android-main-p1-results.json` |
| 同 md 两用户、真实 WS、隔离、卡片、后端重启 | `ios-chat-p1-results.json` | `android-chat-p1-results.json` |
| 两次真实 OTP 登录与错误码、读写、退出 | `ios-login-results.json` | `android-login-results.json` |
| Web 与 Flutter 输入框双向实时消息 | `ios-web-p1-results.json` | `android-web-p1-results.json` |
| 普通安装包进程重启、安全会话恢复 | `ios-normal-restart-p1-results.json`，65107 → 66662 | `android-normal-restart-p1-results.json`，4153 → 4267 |

截图：`ios-chat-p1-chat.png`、`ios-media-p1-image.png`；Web 的 `web-chat-p1.png`、`web-settings-p1.png` 已人工查看。Android 的 `android-chat-p1-chat.png`、`android-media-p1-image.png` 与 `android-device-p1-normal-restart.png` 已留存；iOS 普通包重启截图为 `ios-normal-restart-p1.jpg`。

复验命令见 [app/README.md](app/README.md)。聊天用例会重启本地 backend，应与录音 / ASR 用例串行；所有设备功能用例先断言专用工作区没有智能体，避免调用真实 Agent CLI。

## 自动化检查与限制

- `flutter analyze` 无问题；`flutter test --concurrency=1` 122 项通过。覆盖媒体授权与会话隔离、图片插入异常、音频缺失/读取失败、播放控制、消息重试幂等、分页、卡片校验、多 Agent 对应取消及等待服务端终态。
- `python3 imind/verify_p1.py` 8 项本地实联调通过；`python3 imind/verify_contract.py` 14 项既有契约通过。真实 daemon 分块媒体读写、物理字节、跨用户权限、共享根/文件身份、重命名、revision、WS 与 client_id 去重均有断言。
- `go test -race ./internal/fileshare ./internal/imind ./internal/imindasr` 通过；相关 handler 回归与 `TestEnsureIMindChatIsIdempotentAndFileAccessGated` 通过，`go test ./cmd/migrate` 通过。建群锁另以两个连接的池验证等待者释放连接，且 handler 定向 race 检查通过（`p1-ensure-race.log`）。`make sqlc` 已重新生成。证据：`p1-go-race.log`、`p1-go-final.log`、`p1-ensure.log`、`p1-migrate-final.log`、`p1-wav-validation.log`。
- Core API 138 项测试、Core typecheck、设置组件 ESLint 通过。根/Views typecheck 仍被三个既有错误阻断：`im/chat-documents-section.test.tsx:88`、`im/doc-open-path.ts:3`、`im/reminder-page.test.tsx:410`，本轮未修改这些文件。
- 工作区删除 manifest 测试仍报告既有的 `issue_member`、`push_subscription`、`task_delivered_prompt` 未分类；新增 `imind_group_chat` 已登记，工作区及 issue 删除 SQL 已清理映射。不能据此宣称全量 Go 检查通过。
- 未执行全仓 lint/test、全量 Go 或 Playwright；本轮客户端 E2E 是实际 Flutter 模拟器集成测试，Web 用 Ego 浏览器确认。默认 Agent/JEV 回答与真实任务取消使用仓库允许的受控假执行器，未运行用户安装的真实 Agent CLI。

## Web / Flutter 界面补验

2026-10-29 已完成 iOS 27 和 Android 两轮：在 Web 的真实输入框输入并点击 Send，Flutter 收到后从自己的输入框发送回复；Web 无刷新显示该回复，再从 Web 输入框发送确认，Flutter 断言收到后结束。未通过后台 API 代发这三条验收消息；API 仅用于建立测试文件、加入两位测试成员和读取历史。

统一证据 `web-ui-interop-p1-results.json`，设备日志为 `ios-web-p1.log` / `android-web-p1.log`；截图 `ios-web-interop-p1.png`、`android-web-interop-p1.png`、`web-ios-interop-p1.png`、`web-interop-p1.png` 已查看。测试入口 `--suite web` 的操作步骤见 app/README。测试工作区没有智能体，因此恢复状态显示“Agent 暂不可用”，不冒充智能体回答验收；默认/JEV 回答另由上述受控执行器验证。

## 保留待补验

用户明确确认“仅模拟器，真机项保留待补验”：相机硬件采集与权限交互、实际音频输出可听性及与真人录制内容一致性保留待补验。模拟器麦克风、WAV 字节和原生播放器进度证据不能替代这些项目。

原有其他待办不扩大本次范围：真人语音识别质量、小时级录音与锁屏/后台/来电/断网/进程终止恢复、正式签名分发、AI 命名 Mock。录音当前有约 35 分钟 / 64 MiB WAV 上限，并在达到上限前停止以保留可保存内容。

后续 AI+ 流式语音输入已完成，双端证据见 [VOICE_VALIDATION.md](VOICE_VALIDATION.md)。本报告的 122 项单测为 P1 原轮次；语音实现后的完整回归为 125 项。
