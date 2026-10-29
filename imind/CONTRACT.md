# iMind 接口与 Markdown 契约

版本：v1 HTTP / imind_scope_revision_v1 + imind_rename_v1 + imind_media_v1 daemon（2026-10-28）

## 身份与作用域

- 除登录接口外，全部请求带 `Authorization: Bearer <multica JWT>`；`/api/imind/*` 另带 `X-Workspace-ID: <workspace UUID>`。服务端认证和成员中间件实际验证身份，不信任客户端自行声明的工作区。
- `GET /api/workspaces` 是账户级接口，返回数组；客户端校验/恢复工作区后再访问 iMind。
- `share_machine` 是现有共享知识库的 machine 名；共享的 WorkspaceID 必须等于已验证工作区，再复用现有可见性/所有者授权。工作区共享供成员使用，private 仅原有授权用户使用；不能通过所有者身份跨工作区访问。
- 客户端以安全存储单一 `imind_session` 保存 `base_url`、`token`、`workspace_id`、`share_machine`。会话绑定 API 根，不写入 Multica 数据库；旧未绑定键清理并重新登录。
- 所有 iMind 文件只允许位于 `<share_machine>/iMind/` 的一级物理目录。API 不接受 `../`、绝对路径、非法文件名或目录外目标；daemon拒绝目录/笔记 symlink（检查时存在的链接），列表过滤这些链接。
- daemon 必须声明 `imind_scope_revision_v1: true` 、`imind_rename_v1: true` 和 `imind_media_v1: true`。旧版本仍服务通用 docs，但 iMind 返回 `409 imind_daemon_upgrade_required`，不静默降级。
- 服务端转发 file-share payload 时带 `scope: imind`；通用 docs 无 scope 保持原语义。iMind 删除另带 `expected_revision`，在 daemon同一更新路径锁中重读 SHA-256；不承诺对不协作的直接磁盘写入或恶意并发 symlink 替换提供完整强隔离。

## Markdown 文件

路径：`iMind/<标题>.md`，文件名是标题的唯一来源；创建和修改标题时若重名则追加数字后缀。UUID-v4 保存在 YAML 的 `id` 字段，接口通过元数据查找。UTF-8、最大 4 MiB，复用 `obsidianvault` 的乐观并发 revision。

```markdown
---
imind_version: 1
id: "4e2c1478-6f08-43d8-a949-e07ccf778d99"
type: "note"
created_at: "2026-10-27T10:20:30Z"
updated_at: "2026-10-27T10:22:41Z"
tags: ["日常碎碎念"]
source_url: null
audio: null
---

<!-- imind:content:start -->
# 周末随笔：慢下来的城市

正文是标准 Markdown。
<!-- imind:content:end -->

<!-- imind:transcript:start -->
<!-- transcript: 00:00.000 -->
第一段转写。

<!-- transcript: 00:12.340 -->
第二段转写。
<!-- imind:transcript:end -->
```

约束：

- `type` 仅为 `note`、`recording`、`clip`。
- 普通笔记和剪藏的 transcript 区为空；录音笔记的 transcript 区可为空（录音尚未产生文字）。
- `audio` 是可选对象。旧转写记录可只有 `{"duration_ms":112000,"format":"pcm_s16le","sample_rate_hz":16000}`；有原始音频的记录为 `{"duration_ms":112000,"format":"wav_pcm_s16le","sample_rate_hz":16000,"file":"audio.wav"}`。`file` 只能是 `audio.wav`，相对于该笔记的媒体目录，不能是端侧临时路径。
- HTML 注释分隔符为唯一可信边界，不依赖 `## 原文` 标题；四个分隔符必须各一份、独立行、顺序正确，区外不能有额外非空文本。正文与转写不能包含保留 imind 分隔符。
- UTF-8/头部字段与类型严格校验，拒绝 NUL、重复 JSON 键、未知请求字段、多个 JSON 值及非法类型。
- 时间戳使用 `MM:SS.mmm`，支持超过两位的分钟。原文片段保留多行 Markdown，不只读取第一行。
- `updated_at` 由服务端生成。客户端提交的 `title` 用于确定文件名；元数据不保存标题。`tags`、正文、转写由客户端提交。

## HTTP API

所有下列路由均在 Multica 认证与工作区中间件内，响应使用 JSON。错误沿用 `{ "error", "code" }`，冲突使用 HTTP 409 并返回当前 `revision`。

### `GET /api/imind/shares`

列出用户在当前工作区可写入的共享知识库根。

```json
{ "shares": [{ "machine": "mbp", "name": "MacBook Pro" }] }
```

### `POST /api/imind/bootstrap`

请求：

```json
{ "share_machine": "mbp" }
```

确保根目录有 `iMind/`。若已存在则幂等成功。

### `POST /api/imind/notes/list`

请求：

```json
{ "share_machine": "mbp", "tag": "工作" }
```

响应按 `updated_at` 倒序：

```json
{ "notes": [{ "id": "uuid", "type": "recording", "title": "产品周会", "tags": ["工作"], "updated_at": "2026-10-27T10:22:41Z", "duration_ms": 112000, "source_url": null, "path": "mbp/iMind/产品周会.md", "revision": "sha256" }] }
```

### `POST /api/imind/notes`

创建普通笔记、剪藏或空录音笔记。请求携带 `share_machine`、`type`、`title`、可选 `tags`、`source_url`、`content` 和 `audio`。服务端生成 UUID、时间和完整文件内容。

### `POST /api/imind/notes/get`

请求 `{ "share_machine": "mbp", "id": "uuid" }`，响应包含元数据、`content`、`transcript`、`revision` 和 `path`。

### `PUT /api/imind/notes/{id}`

请求包含 `share_machine`、`revision`、`title`、`tags`、`content`、`transcript`、`audio`。服务端解析现有文件，验证 ID 一致，以 `obsidianvault` 的 revision 写入完整 Markdown；不接受客户端提供的路径、`created_at` 或 `updated_at`。

### `DELETE /api/imind/notes/{id}`

请求 `{ "share_machine": "mbp", "revision": "sha256" }`。服务端先验证文件 ID 和 revision，再删除。

## 登录

复用：

1. `POST /auth/send-code`，`{ "email": "..." }`
2. `POST /auth/verify-code`，`{ "email": "...", "code": "123456" }`

客户端把响应的 `token` 写入 `flutter_secure_storage` 的绑定会话中；请求 401 时清空持久化与内存会话，并撤销全部已登录页面返回登录页。验证码接口的 401 不清理现有登录；旧请求结果不覆盖新会话。HTTP默认超时20秒，重定向不转发凭据。开发环境使用 `MULTICA_DEV_VERIFICATION_CODE`，不能在客户端硬编码测试账号或验证码。

## 实时 ASR WebSocket

`GET /api/imind/asr?share_machine=<machine>` 升级 WebSocket（认证头与当前工作区上下文必需）。

客户端到服务端：

```json
{ "type": "start", "sample_rate_hz": 16000, "format": "pcm_s16le", "language": "zh" }
```

服务端返回 `{ "type": "ready" }`（上游task-started）后才开始发送二进制 PCM 帧。结束发送 `{ "type": "stop" }`，继续接收尾部 final，直到 `{ "type": "done" }`（上游task-finished）才完成保存。每个片段另含 `sentence_id`，`start_ms/end_ms` 只在上游提供时存在；客户端暂停重连映射独立句ID并累加时间，不覆盖前一段。Token仅在升级头，不放首帧或URL。

服务端到客户端：

```json
{ "type": "partial", "start_ms": 0, "end_ms": 1240, "text": "好，我们开始今天的周会" }
{ "type": "final", "start_ms": 0, "end_ms": 1240, "text": "好，我们开始今天的周会" }
{ "type": "error", "code": "asr_unavailable", "message": "..." }
```

服务端把上述帧翻译成百炼 `qwen-audio-3.1-asr-flash-message` 的 `run-task` / 二进制 PCM / `finish-task` 协议，上游地址为 `wss://<DASHSCOPE_WORKSPACE_ID>.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`。`DASHSCOPE_API_KEY` 与工作空间 ID 只从服务端环境读取，不进入仓库或 App。句级 `begin_time` 会作为 `start_ms` 返回，客户端写成 `<!-- transcript: MM:SS.mmm -->`。

## 图片与原始音频

- 媒体存储在物理共享根 `iMind/media/<note UUID-v4>/<filename>`。Markdown 使用相对图片引用 `![图片](media/<UUID>/<随机文件名>.png)`，在知识库中也能按相对路径读取，不包含 token、服务器磁盘路径或设备临时路径。
- `POST /api/imind/media?share_machine=<machine>&id=<note UUID>&name=<filename>` 使用原始二进制请求体，`Content-Type` 为 `image/jpeg`、`image/png`、`image/webp` 或 `audio/wav`。图片文件名为至少 16 位字母、数字或连字符加图片后缀；录音文件名固定为 `audio.wav`。不是 Base64 JSON 上传。
- `GET /api/imind/media/{id}/{name}?share_machine=<machine>` 返回原始字节。上传与读取均验证 Bearer、工作区成员、共享根权限及笔记存在性；返回 `private, no-store` 和 `nosniff`，无匿名公开下载链接。客户端禁止媒体请求重定向，并检查请求期间的登录/工作区变更。
- 图片上限 16 MiB，音频上限 64 MiB。WAV 必须是完整的 RIFF/WAVE、16 kHz、单声道、16-bit PCM，拒绝畸形长度、不同采样率和其他编码。录音达到约 35 分钟上限前停止并保留可保存内容；小时级录音仍非已验证范围。
- 专用 daemon 操作 `imind_media_write/read` 使用 `scope: imind`、512 KiB 分块和每次上传独立随机 ID。只允许上述 UUID 目录和文件名；拒绝静态 symlink/非普通文件，完成前写入私有暂存文件，最后原子 rename。沿用已接受的非协作写入边界。
- 录音从送给 ASR 的同一 PCM 流保存，暂停不加入静音间隔，续录追加，停止继续等待尾部转写。保存失败留在录音页，保留 PCM、图片和已创建笔记的身份，重试不会再创建一条笔记；保存成功后依赖共享根中的 WAV，退出页面或重启不依赖临时文件。
- 图片取消与权限拒绝不修改正文；失败保留原有文字。尚未保存的边录边记图片留在当前草稿，最终保存时上传并替换为持久引用。旧无 `audio.file` 的录音显示“无原始录音”；读取和播放失败给出重试反馈。

## AI+ 文件专属群聊

### 流式语音输入

AI+ 输入框使用与录音页相同的 `record` PCM 采集和 `AsrSession`，通过上述 `/api/imind/asr` 服务识别，不引入端侧模型或新鉴权协议。16 kHz 单声道 PCM、升级请求身份/工作区/共享根授权与录音页一致。

点麦克风后先申请权限并校验共享访问，等 ASR ready 才采集。partial 实时写入启动时的光标/选区：同一句按 sentence_id 替换，final 固定该句，后续句追加；保留选区外的原有草稿。识别期间输入框只读，发送暂不可用。点停止先停麦克风，再等待 final/done；之后可编辑并手动发送，语音输入本身不会自动发送群消息。

拒绝权限、断线及最终结果超时保留原稿和已识别文字，显示恢复提示，可重新点击麦克风。关闭聊天弹层销毁采集、连接和监听；不保存这段口述的原始音频或新建录音笔记。

### 绑定与加入

`POST /api/imind/chats/ensure` 请求 `{share_machine,note_id,revision}`，返回 `{issue_id,identifier,title,joined,chat}`。`revision` 必需，过期返回 `409 imind_conflict`。新笔记先成功保存；聊天使用已保存版本，保存失败保留草稿并反馈。

服务端 `imind_group_chat` 用工作区 UUID、共享根身份（owner + daemon ID + 规范化根目录的 SHA-256）与笔记元数据 UUID 绑定普通 group-chat issue。文件名及可变 machine 昵称不参与身份。事务锁串行首次创建，issue 与绑定原子提交，两个 concurrent 唯一索引防止重复。每次展开幂等加入当前用户，关闭只释放客户端监听，不退群。文件重命名复用原群聊，不同文件隔离。

群聊普通 issue/评论接口、群聊列表/搜索和实时收件人都复核当前文件/共享根权限。成员资格不能扩大文件访问范围；共享目录不可用时暂停读取并可恢复同步。删除群聊或工作区按应用层清理关联，不使用 foreign key。

### 默认处理智能体与分发

- `GET /api/imind/settings/default-agent` 返回 `{agent_id: UUID|null}`，工作区成员可读。
- `PUT /api/imind/settings/default-agent` 请求及响应相同，只有 owner/admin 可写，并校验工作区和智能体使用权限。Web/Desktop 的“工作区 → 常规 → iMind”配置此项；不存在或不可访问的配置显示不可用，可重新选择或清除。
- 默认处理智能体作用于已有及新建文件群聊。每次消息都校验、加入并交给既有群聊运行调度；无配置时复用 `groupchat.ChooseAnswerer` 的 JEV 选择及原有入群/排队流程。Flutter 不选择智能体，不生成本地替代回答。
- 运行上下文从共享根读取当前已保存 md，明确包含可访问的 `<machine>/iMind/<filename>.md` 引用、读取 revision、正文和转写；不会将未保存编辑冒称落盘内容。

### 消息、实时与取消

- 历史：`GET /api/issues/{id}/comments/page`，使用既有 `before_created_at/before_id` 分页。
- 发送：`POST /api/issues/{id}/comments`，`{content,type:"comment",client_id:<UUID>}`。客户端为一次发送保留稳定 `client_id`；同工作区、任务、作者和 ID 的重试返回原评论，不重复发消息或调度。
- 评论附带可选 `imind_agent_status`（`queued` / `unavailable`），在历史中持久保存。无可用智能体/分发失败保留评论，显示恢复入口；`POST /api/imind/chats/{id}/retry` 的 `{comment_id}` 只允许原作者且当前文件有权访问，已有活动运行时幂等返回，不重复调度。
- WebSocket `/ws?workspace_id=<UUID>` 使用现有 auth 首帧（token 不在 URL），按群聊 issue ID 过滤 `comment:created/updated/deleted`、`group_chat:updated`、`imind:message_status` 和 `task:queued/running/completed/failed/cancelled`。重连回拉已加载历史窗口和活动运行，补齐更新与删除并按 ID 去重；共享根晚于服务恢复时继续重试。关闭、换文件及退出登录销毁监听和计时器。
- 活动运行来自 `GET /api/issues/{id}/task-runs`。每个运行独立红色终止按钮调用 `POST /api/issues/{id}/tasks/{taskId}/cancel`，提交中禁用，随后以响应、运行事件和重新读取状态收敛。失败保留反馈及重试，不取消其他群聊的运行。
- Markdown 使用 `flutter_markdown`。`docs` / `obsidian` fenced JSON 的 `name/summary/path` 与 Web 同规则解析：相对 `.md` 路径、禁止绝对路径及 `.`/`..`，缺省标题取文件名、摘要合并空白，畸形内容保持可读。卡片经已认证的 `/api/docs/files/content` 打开，不直接打开服务器路径。

## 本地验证码登录验收

`app/tool/run_login_e2e.py` 使用当前 checkout 环境配置，通过 Docker PostgreSQL 读取专用测试邮箱的动态验证码。开始发送前记录数据库时钟边界；只取本次边界后的最新、未使用、未过期且 attempts < 5 的记录，尊重 60 秒重发限制。测试桥仅监听 loopback，Android 用 `adb reverse`，每次运行使用随机鉴权值。验证码只驻留进程内存，不放入 Dart defines、仓库或日志；设备必须实际调用 send-code/verify-code。预置 token 功能测试不计为验证码登录通过。

## 非目标

- 网页剪藏只从粘贴文本中识别 `https?://...`，创建 `clip` 笔记；不下载网页、图片或正文。
