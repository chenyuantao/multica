<!-- imind:managed-agent-instructions -->
# iMind 笔记生成指南

本文件由 Multica 自动维护。智能体可在本 AGENTS.md 所在目录直接创建 UTF-8 Markdown 笔记，无需修改数据库。iMind 刷新列表后会读取合规文件；普通 Markdown 和本 AGENTS.md 不会显示为笔记。

## 新建普通笔记

1. 在本目录创建 `<标题>.md`，不要放入子目录或使用符号链接。标题取自文件名，不需要在 YAML 中写 `title`。
2. 文件名使用可见、非空的标题，避免控制字符及 `<>:"/\|?*`，标题的 UTF-8 长度不超过 160 字节。不要使用 `AGENTS.md`；遇到重名追加 ` (2)`、` (3)`，使用独占创建，绝不覆盖已有文件。
3. 用 `python3 -c 'import uuid; print(uuid.uuid4())'` 等方式生成新的小写、带连字符 UUID v4。每条笔记的 `id` 必须唯一，不要复用示例或其他笔记的 ID。
4. 按下列模板写入完整文件。替换 ID 和时间，时间使用带时区的 RFC 3339 格式；新建时两个时间相同。普通笔记使用 `type: note`，无链接或录音时保留 `null`，无标签时使用 `[]`。

```markdown
---
imind_version: 1
id: 08b22447-b512-4079-b8a1-47a3798135ab
type: note
created_at: 2026-10-31T00:00:00Z
updated_at: 2026-10-31T00:00:00Z
tags: []
source_url: null
audio: null
---

<!-- imind:content:start -->
# 笔记正文

在这里写 Markdown 内容。
<!-- imind:content:end -->

<!-- imind:transcript:start -->

<!-- imind:transcript:end -->
```

## 格式约束

- 使用 UTF-8、LF 换行，不带 BOM 或 NUL；完整文件不超过 4 MiB。文件必须从 `---` 和换行开始，YAML 头部后依次为正文区、原文区。
- 模板中的四个 HTML 注释分隔符必须各出现一次、独占一行且顺序不变。正文、原文、标题、标签、摘要和剪藏文本中不得再次包含它们（代码块内也不例外）。各区域之间及最后一个分隔符之后只能有空白。
- `imind_version` 是整数 `1`；`id`、`type` 和可选 `summary` 是字符串；`tags` 是非空字符串组成的数组，数字等标签需要加引号。YAML 字段不得重复。
- `source_url` 为 `null` 或含主机名的 `http://` / `https://` URL，不能包含用户名密码。
- 可选 `summary` 用于简短摘要；额外 YAML 元数据会保留。编辑已有笔记时保留原 `id`、`created_at`、类型、来源、音频、剪藏信息及未知字段，更新 `updated_at`。修改标题需要重命名文件。
- 编辑前重新读取文件，避免覆盖用户同时进行的修改；可在同目录临时文件中准备完整内容，确认原文件未变后再替换。新建始终使用独占创建。

## 剪藏和录音

- 剪藏使用 `type: clip`。正文区放整理后的内容，原文区留空，`audio: null`。来源放 `source_url`；需要保留原始输入时增加 `clip: {original_text: "原始文本", prompt: "用户要求"}`，两个值必须是字符串。`clip` 只用于剪藏。
- 录音使用 `type: recording`。正文区放笔记，原文区放转写文本。`audio` 可以为 `null`；有音频时使用 `duration_ms`（非负整数）、`format`（`pcm_s16le` 或 `wav_pcm_s16le`）、`sample_rate_hz: 16000`。
- 有音频文件时放在本目录下 `media/<笔记 ID>/audio.wav`，音频元数据增加 `file: audio.wav` 且 `format: wav_pcm_s16le`。应为真实的 16 kHz PCM s16le WAV，不要伪造音频元数据或文件。
- 普通笔记和剪藏的原文区必须留空，不能带音频元数据；引用原文可写入正文区。

## 保存后检查

确认文件名、UUID、时间、YAML 类型和四个分隔符正确，再刷新 iMind 列表。格式不合法的文件会被跳过；不要通过反复新建副本解决格式问题。新建文件不会自动创建 AI+ 群聊，群聊由应用后续打开时建立。

维护者修改笔记格式、命名、解析、媒体或目录规则时，必须同步更新此指南及相关示例测试。指南源码为 `server/internal/imind/agent-instructions.md`，由后端通过现有文件共享协议下发；发布新版后端后，已生成指南会在 iMind 初始化或读取目录时同步更新，无需升级 multica-operate。不要直接修改生成副本。
