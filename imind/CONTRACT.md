# iMind 接口与 Markdown 契约

版本：v1 HTTP / imind_scope_revision_v1 + imind_rename_v1 + imind_media_v1 daemon（2026-10-30）

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
- 可选 `summary` 保存 AI 生成摘要；旧文件默认为空。剪藏的可选 `clip` 对象保存 `original_text`（原始粘贴文本）与 `prompt`（可选提示词），`source_url` 保留提取出的 URL。修改标题、正文或标签保留这些元数据。
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

创建普通笔记、剪藏或空录音笔记。请求携带 `share_machine`、`type`、`title`、可选 `tags`、`source_url`、`content`、`audio` 和 `clip`。服务端生成 UUID、时间和完整文件内容。

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

`GET /api/imind/chats/unread` 返回当前工作区中用户已加入、且仍有共享根访问权限的文件群聊 `{chats:[{share_machine,note_id,issue_id,title,unread_count}]}`。只读，不创建群聊或加入成员；未读数取服务端 inbox 状态。取得群聊最新消息后调用既有 `POST /api/group-chats/{issue_id}/read`，成功后刷新未读映射。首页与详情按 `share_machine + note_id` 显示未读数；App 图标显示当前工作区可访问 iMind 群聊的未读消息总数。

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
- WebSocket `/ws?workspace_id=<UUID>` 使用现有 auth 首帧（token 不在 URL）。登录会话维持一个工作区级连接，未读事件刷新当前工作区所有可访问 iMind 群聊的服务端计数；AI+ 弹层复用该连接，按当前 issue ID 过滤 `comment:created/updated/deleted`、`group_chat:updated`、`imind:message_status` 和 `task:queued/running/completed/failed/cancelled`。重连回拉未读映射、已加载历史窗口和活动运行，补齐更新与删除并按 ID 去重；共享根晚于服务恢复时继续重试。关闭弹层只释放其监听；退出登录或切换工作区销毁连接与旧角标。当前原生本地通知依赖 App 进程收到 WebSocket 事件，系统挂起或终止进程后的可靠送达需另接远程推送。
- 活动运行来自 `GET /api/issues/{id}/task-runs`。每个运行独立红色终止按钮调用 `POST /api/issues/{id}/tasks/{taskId}/cancel`，提交中禁用，随后以响应、运行事件和重新读取状态收敛。失败保留反馈及重试，不取消其他群聊的运行。
- Markdown 使用 `flutter_markdown`。`docs` / `obsidian` fenced JSON 的 `name/summary/path` 与 Web 同规则解析：相对 `.md` 路径、禁止绝对路径及 `.`/`..`，缺省标题取文件名、摘要合并空白，畸形内容保持可读。卡片经已认证的 `/api/docs/files/content` 打开，不直接打开服务器路径。

## 本地验证码登录验收

`app/tool/run_login_e2e.py` 使用当前 checkout 环境配置，通过 Docker PostgreSQL 读取专用测试邮箱的动态验证码。开始发送前记录数据库时钟边界；只取本次边界后的最新、未使用、未过期且 attempts < 5 的记录，尊重 60 秒重发限制。测试桥仅监听 loopback，Android 用 `adb reverse`，每次运行使用随机鉴权值。验证码只驻留进程内存，不放入 Dart defines、仓库或日志；设备必须实际调用 send-code/verify-code。预置 token 功能测试不计为验证码登录通过。

## 命名与后台配置

`POST /api/imind/notes/{id}/ai-name` 请求 `{share_machine,revision}`，读取该 md 已保存正文和转写，由服务端向 `https://api.deepseek.com/chat/completions` 请求标题和摘要。使用快速 `deepseek-flash`、`thinking: {type: "disabled"}`、`reasoning: {effort: "low"}`，两个入口共用同一调用。成功沿用更新/重命名与重名后缀契约，返回完整 note；summary 保存于 YAML，标题仅来自文件名。生成期间发生修改返回 409，不能覆盖新版本。

`POST /api/imind/notes/{id}/ai-tag` 请求 `{share_machine,revision}`，使用同一工作区的 DeepSeek Key 和快速非思考模型生成 2–10 个标签，优先匹配当前授权共享根中已保存笔记的标签。成功合并原有标签并返回完整 note；模型响应无效或调用失败返回 502，未配置返回 503，生成期间笔记改变返回 409，均不覆盖笔记。

Flutter 录音在笔记、音频和图片全部保存成功后立即调用命名接口；手动 AI 命名读取所选 revision。无 Key 返回 503 `imind_deepseek_unconfigured`，上游失败返回 502 `imind_naming_failed`，均不修改原文件。录音页显示已保存与重试命名入口，可保留原标题退出；用户随后可手动重命名。生成摘要在录音详情展示。

- `GET /api/imind/settings/deepseek` 返回 `{configured:boolean}`，不返回密钥。`PUT` 请求 `{api_key:string}`，空字符串清除；只有工作区 owner/admin 可写。
- Key 仅由后台录入，按工作区加密保存在数据库；不传到 Flutter、不写入 Markdown/日志/仓库。部署需设置 32 bytes base64 `MULTICA_IMIND_SECRET_KEY`，未设置拒绝配置，轮换后需重新录入已有配置。该部署加密密钥与模型 API Key 不同。
- `GET/PUT /api/imind/settings/clip-agent` 使用 `{agent_id:UUID|null}`，权限、工作区和智能体使用权限与 default-agent 设置相同。

## 工作区 LLM 提示词模板

`GET /api/imind/settings/prompts` 返回 `prompts` 和 `variables`。每个模板包含 `kind`、`default_template`、当前生效的 `template` 和 `custom`。四种 kind 为 `file_title`（普通文件及剪藏文件的 DeepSeek 标题/摘要）、`recording_title`（语音文件的 DeepSeek 标题/摘要）、`processor`（非剪藏文件的默认处理智能体上下文）、`clip`（剪藏智能体的转存与原文件回写上下文）。默认内容由服务端统一提供，Web/Desktop 的“工作区 → 通用 → iMind”输入框直接展示当前生效值；客户端不用重装即可使用后端的新配置。

`PUT /api/imind/settings/prompts` 接收 `{ "kind": "processor", "template": "..." }`，仅 owner/admin 可修改，工作区成员可读取。同一请求只更新一个模板，避免覆盖其他管理员对另一模板的修改。未保存过使用系统默认值；保存后完整覆盖该模板；显式传 `template: null` 删除覆盖并恢复默认。空白模板、未知变量、未知 kind、缺少 template、非字符串值及超过 32 KiB 的模板返回 400，已有配置不变。响应与 GET 相同。

模板使用严格大写的 `{{VARIABLE}}`，仅单次字面替换，不执行模板代码，也不递归展开文件内容里的变量。展开结果超过 8 MiB 时拒绝调用，不截断文件内容。所有值来自当前授权文件的已保存版本：

| 变量 | 值 |
| --- | --- |
| `EXISTING_TAGS` | 当前授权共享根已保存笔记标签的 JSON 数组；智能体自定义模板未引用时仍附加上下文 |
| `FILE_CONTENT` | 完整 Markdown 字符串，包含 YAML 元数据、正文和转写分隔符 |
| `FILE_PATH` | 包含主机名的共享文件路径，如 `mac/iMind/笔记.md` |
| `FILE_RELATIVE_PATH` | 相对共享根目录的路径，如 `iMind/笔记.md` |
| `SHARE_MACHINE` | 共享主机名 |
| `FILE_TITLE` | 当前文件名，不含 `.md` |
| `FILE_TYPE` | `note`、`recording` 或 `clip` |
| `FILE_ID` | 笔记的固定 UUID |
| `FILE_REVISION` | 当前已保存版本，用于保护写入 |
| `FILE_BODY` | 不含 YAML 元数据的笔记正文 |
| `TRANSCRIPT` | 语音转写文本 |
| `SOURCE_URL` | 来源 URL，无来源时为空 |
| `CLIP_ORIGINAL_TEXT` | 原始剪藏文本；旧文件无 clip 元数据时取正文 |
| `CLIP_INSTRUCTIONS` | 当前文件的额外剪藏要求，无要求时为空 |

DeepSeek 调用仍要求返回包含非空 `title` 和 `summary` 的 JSON；结构、文件名和 revision 校验继续由服务端执行。自定义模板可以替换处理/剪藏的操作要求，但不改变共享目录权限、写入保护和同一文件群聊绑定。

## 剪藏占位文件与执行

客户端正则提取链接，先创建默认名 `生成中的剪藏1` 的 `clip` 文件，正文和 `clip.original_text` 保留用户原始文本，元数据 `source_url` 保存提取链接，`clip.prompt` 保存可选提示词。创建失败不建群；创建成功后以同一 note UUID/revision ensure 群聊，再发送链接和提示词（稳定 client_id），打开同一 AI+。关闭重开不会再次发送初始化消息。

Ensure 把已配置默认智能体和剪藏智能体按权限加入同一个文件群。剪藏优先派给剪藏智能体；未指定剪藏智能体时使用 JEV，默认智能体仍加入。调度上下文含已保存 md 的授权引用和 revision，要求智能体抓取网页、按已有文档工具回写同一占位文件并保留 UUID、剪藏元数据与唯一分隔符，允许按现有契约改名。服务端不另设抓取/聊天体系。分发、抓取或回写失败保留原文件和群聊，已有消息重试分发使用原入口。

## 输入安全区与运行详情

笔记编辑、录音页/边录边记、AI+ 和剪藏输入使用 `max(viewInsets.bottom, viewPadding.bottom)`；全屏编辑页关闭 Scaffold 自动键盘缩放，由容器统一保留底部空间，避免重复键盘间距。

活动运行作为对应 Agent 消息（尚无回复时为消息占位气泡）显示查看与红色终止；`source_task_id` 与 `trigger_comment_id` 定位，多个运行独立。查看打开有独立返回控件的执行详情页，通过 `GET /api/tasks/{id}/messages` 显示思考、工具调用/输出及回复。消息和详情均调用原 issue 范围取消接口，提交中“正在终止”，等待服务端终态，失败可重试。

## 非目标

- 导出、回收站恢复、真机拍照与实际听音不属于本轮模拟器优化验收。

## 2026-10-30 客户端交互

- 首页在返回详情（包括系统侧滑返回）后重新读取列表；下拉刷新同样调用现有列表 API，空列表仍可下拉。
- 首页 hashtag 胶囊可多选：标签间为 OR，与文件类型筛选为 AND；「取消」清除标签选择，保留类型条件。筛选由客户端基于授权列表执行，不改变列表接口。
- 已保存笔记阅读态仅通过右上角「编辑」进入编辑；新笔记直接进入编辑。阅读态允许系统返回手势。编辑态系统返回或 iOS 边缘返回手势先拦截并展示二次确认；「继续编辑」保留草稿，「放弃」停止语音输入后完整退出详情页，顶部「放弃」也直接完整退出。保存成功仍返回阅读态。
- 图片在授权读取后通过 `imind/image_viewer` 原生通道查看：iOS Quick Look、Android ACTION_VIEW 与受限缓存 FileProvider；外部图片按现有 URL 读取，不附带账户凭据。
- 编辑器复用 VoiceInput / AsrSession，转写写入启动时的光标位置，保留后文；活动期间锁定手动正文及格式操作，停止排空最终结果后可继续编辑，保存前等待停止。
