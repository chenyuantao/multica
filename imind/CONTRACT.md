# iMind 接口与 Markdown 契约

版本：v1（2026-10-27）

## 身份与作用域

- 除登录接口外，全部请求带 `Authorization: Bearer <multica JWT>`。
- `share_machine` 是现有共享知识库的 machine 名；服务端必须用当前用户和工作区的现有 `FileShares` 授权逻辑验证它，不能信任任意本地路径。
- 该值由客户端首次选择后用平台安全存储保存；它不进入 Multica 数据库。
- 所有 iMind 文件只允许位于 `<share_machine>/iMind/`。API 不接受 `../`、绝对路径或 `iMind` 以外的目标。

## Markdown 文件

路径：`iMind/<uuid-v4>.md`。标题改动不重命名文件。UTF-8、最大 4 MiB，复用 `obsidianvault` 的乐观并发 revision。

```markdown
---
imind_version: 1
id: "4e2c1478-6f08-43d8-a949-e07ccf778d99"
type: "note"
title: "周末随笔：慢下来的城市"
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
- `audio` 是可选对象，形如 `{"duration_ms":112000,"format":"pcm_s16le","sample_rate_hz":16000}`；本版本不上传/保留音频文件。
- HTML 注释分隔符为唯一可信边界，不依赖 `## 原文` 标题，因标题可被用户编辑。
- `updated_at` 由服务端生成。`title`、`tags`、正文、转写由客户端提交。

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
{ "notes": [{ "id": "uuid", "type": "recording", "title": "产品周会", "tags": ["工作"], "updated_at": "2026-10-27T10:22:41Z", "duration_ms": 112000, "source_url": null, "path": "mbp/iMind/uuid.md", "revision": "sha256" }] }
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

客户端把响应的 `token` 写入 `flutter_secure_storage`；请求 401 时清空并回到登录页。开发环境使用 `MULTICA_DEV_VERIFICATION_CODE`，不能在客户端硬编码测试账号或验证码。

## 实时 ASR WebSocket

`GET /api/imind/asr?share_machine=<machine>` 升级 WebSocket（认证头与当前工作区上下文必需）。

客户端到服务端：

```json
{ "type": "start", "sample_rate_hz": 16000, "format": "pcm_s16le", "language": "zh" }
```

随后发送二进制 PCM 帧；结束时发送 `{ "type": "stop" }`。

服务端到客户端：

```json
{ "type": "partial", "start_ms": 0, "end_ms": 1240, "text": "好，我们开始今天的周会" }
{ "type": "final", "start_ms": 0, "end_ms": 1240, "text": "好，我们开始今天的周会" }
{ "type": "error", "code": "asr_unavailable", "message": "..." }
```

服务端把上述帧翻译成百炼 `qwen-audio-3.1-asr-flash-message` 的 `run-task` / 二进制 PCM / `finish-task` 协议，上游地址为 `wss://<DASHSCOPE_WORKSPACE_ID>.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`。`DASHSCOPE_API_KEY` 与工作空间 ID 只从服务端环境读取，不进入仓库或 App。句级 `begin_time` 会作为 `start_ms` 返回，客户端写成 `<!-- transcript: MM:SS.mmm -->`。

## 非目标

- AI+ 是本地 Mock，不定义模型调用接口。
- 网页剪藏只从粘贴文本中识别 `https?://...`，创建 `clip` 笔记；不下载网页、图片或正文。
- 本版本不存储原始音频，只有可编辑的时间戳转写 Markdown。
