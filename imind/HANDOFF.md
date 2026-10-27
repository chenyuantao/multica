# iMind Flutter App — 方案、进度与交接

最后更新：2026-10-27

## 目标

依据 `imind/design/index.html` 的 18 个移动端画板，实现一个 iOS/Android 同构的 Flutter iMind App。服务端复用 Multica 已有的认证、工作区成员校验和共享知识库（`/api/docs` / file-share）能力；笔记落在知识库根目录的 `iMind/` 下，一个笔记对应一个 Markdown 文件。

## 已确认的现状

- 设计覆盖：首页、侧栏和标签、普通笔记编辑/阅读、网页 URL 剪藏、录音实时转写、录音原文/笔记、AI+ 写作和问答 Mock。
- Multica 已有 JWT 登录接口：`POST /auth/send-code`、`POST /auth/verify-code`；成功响应包含 `token`。
- Multica 已有共享知识库文件 API。知识库归属于已连接的 file-share daemon，访问控制已经按用户和工作区处理；不需要新增数据库表。
- 通用 `/api/docs` 以 machine 名作为路径根。因此 iMind 的专用接口必须接收一个已经可访问的共享根（`share_machine`），并只允许在该根的 `iMind/` 中读写。
- Flutter 3.47.8、CocoaPods 1.17.0 已安装。验收标准已改为 Android 模拟器，不再以 iOS 16 模拟器为通过条件。

## 架构决策

1. 新增服务端 `/api/imind/*`：将 UI 所需的“笔记”模型映射为现有 `obsidianvault` 文件读写，不新建表或字段。
2. 每个请求传 `share_machine`，服务端经现有 `FileShares` 的授权与可见性检查定位共享知识库。客户端在首次进入后选择可访问根，并在安全存储中持久化其名称。
3. 笔记文件一律放在 `<share root>/iMind/<UUID>.md`；文件名不承担标题，避免标题改名、非法字符和冲突问题。
4. 前端用 Flutter + 原生 Markdown 编辑模式（源码编辑与预览）实现跨端编辑；若无法达到编辑体验，才降级为 WebView，不能把 WebView 作为首选。
5. 语音由客户端采集 PCM 后连接服务端 WebSocket；服务端持有阿里云百炼凭证并代理 qwen-audio-3.1-asr-flash-message。密钥只从本机私有环境读取，绝不写入 Git、Markdown 或 App 包。
6. AI+ 只构建交互与 Mock 回复，不调用模型接口；网页剪藏仅正则识别 URL、创建 `clip` 笔记，不抓取网页。

详细的文件格式和 HTTP/WS 契约见 [CONTRACT.md](CONTRACT.md)。

## 实施进度

- [x] 审查设计稿、现有认证与共享知识库实现。
- [x] 确定无数据库迁移的存储边界和 Markdown 格式。
- [x] 建立 Flutter 项目、依赖与导航骨架。
- [x] 新增 iMind 服务端笔记 API 与测试。
- [x] 新增 `GET /api/imind/asr`，把手机 PCM 翻译成 `qwen-audio-3.1-asr-flash-message` 的 run-task 协议。
- [x] 实现登录、令牌安全持久化、共享根选择和笔记读写客户端。
- [x] 实现 Markdown 编辑、时间戳原文编辑、URL 识别剪藏和 AI+ Mock。2026-10-27 模拟器验收：新建笔记 `VerifyNote`，正文先写成 `EditOne`，加粗后是 `**EditOne**`；撤回回到原文，重做恢复加粗。标题、列表、有序列表各自写入后再撤回，仍回到 `**EditOne**`。再次打开后追加文字并保存，文件仍在 `imind:content` 分隔符之间，原有加粗段落还在。编辑区占满工具栏下方空白，点空白进入编辑。笔记页「更多」含「导出（暂不可用）」「重命名」「删除」。模拟器里把 `VerifyNote` 改成 `RenamedNote`，加上标签 `Daily` 后保存，文件头和正文分隔符都还在。侧栏「#Daily」只留下这一篇，标题是「# Daily」，数量是「1 个文件」。长按进入多选后，「导出」不可点；「标记」列出已有标签 `#Daily` 和「使用新标签」。编辑页顶栏是撤回、重做、更多和完成；格式栏同一行放得下 AI+、标签、标题、加粗、列表、有序列表。标题下显示 `#Daily` 和字数。点正文空白会进入编辑。未进入编辑时不显示底部格式栏，顶栏只有返回和更多。进入编辑后顶栏变为放弃、撤销、重做和保存，格式栏出现在屏幕底部。保存或放弃都留在当前页：保存写入文件并回到阅读，放弃丢掉这次修改。录音详情不再打开单独编辑页，右上角也没有修改按钮。点正文才进入编辑；只切换「原文」和「笔记」不会进入编辑。已经在编辑时，切换两边仍留在同一次编辑里。放弃或保存都留在详情页，放弃不写文件。顶栏撤回可用，撤回后重做变为可点。首页「排序方式」会在最新和最早之间切换；验收后已切回最新在前。
- [x] 在已连接的 file-share 与本地 API 上跑通登录和笔记往返。2026-10-27：同一账号的 `multica-operate` 把 `/tmp/imind-knowledge` 以 `imindhost` 挂到本地 API。模拟器里新建笔记后，文件落在 `iMind/<uuid>.md`，正文在 `imind:content` 分隔符之间。剪藏从一句话里抽出 `https://example.com/note`，写成 `type: clip`。
- [x] 2026-10-27 回归：录音详情阅读态依次切换「原文 → 笔记 → 原文」始终保持阅读态；没有出现放弃、撤销、重做或保存。
- [x] 2026-10-27 回归：在同一录音编辑会话中分别修改笔记和时间戳原文，保存后两项均写入同一 Markdown 文件；再保存恢复原内容，四个 `imind` 内容/原文分隔符仍各一份。
- [x] 后端窄范围回归：`go test ./internal/imind ./internal/imindasr ./internal/handler` 通过。
- [ ] iOS 16 验收仍阻塞：2026-10-27 确认 `/Applications/Xcode.app` 不存在，`xcode-select` 指向 CommandLineTools，`flutter doctor` 报完整 Xcode 缺失。Android 模拟器是当前验收路径。
- [x] 语音原文用同一个 Markdown 编辑器打开。模拟器里打开录音笔记时，编辑区载入 `<!-- transcript: 00:01.200 -->`，追加文字后时间戳仍留在文件里。
- [x] AI+ 写作面板返回 Mock 回复，没有调用模型接口。
- [x] 实时转写协议已用真实模型跑通。把 16kHz 单声道 PCM 送进 `GET /api/imind/asr` 后，服务端返回 `ready`、逐字 `partial`，以及 `final start_ms=160 end_ms=5580`，文本是「今天我在记录一条语音笔记，时间戳应该出现在原文里。」模拟器已改用本机麦克风重新启动，录音页连上转写接口约 85 秒。本机麦克风实测是静音（约 -91 dB），扬声器播放进不去麦克风，页面没有出现句子。
- [x] 在 Android 15（API 35）模拟器 `imind_pixel6` 上安装并打开 App。登录页、验证码登录、重启后保留登录态已实测。
- [x] 首页按设计稿显示大标题、分类元信息和底部「录音 / 笔记」。侧栏「音频」只留下录音；录音详情「原文」显示 `00:01` 和「第一句 more」，「笔记」显示正文。更多菜单含「排序方式」「网页剪藏」。共享根名称写入安全存储 `imind_share_machine`。

## 交接时必须更新

每完成一个功能，在本节勾选并写入验证命令/结果；未完成或受外部条件阻塞的事项移入下方。

## 当前遗留与风险

- 验收改为 Android 模拟器。iOS 仍被 Xcode 14.0.1 挡住（`xcodebuild` 不认识 `-skipPackageSignatureValidation`），不再作为本次通过条件。
- 2026-10-27 Android 验收：Colima 上的 PostgreSQL 已迁移，API 监听 `127.0.0.1:18607`。模拟器 `emulator-5554`（Android 15，1080×2400）跑通 `flutter run`。登录后首页显示「当前工作区还没有已连接的共享知识库」；`am force-stop` 后重新打开仍停在首页，说明凭证已写入安全存储。调试包用 `http://10.0.2.2:18607`，并允许明文 HTTP。
- `markdown_editor_plus` 依赖的 `font_awesome_flutter` 10.12.0 无法在 Flutter 3.47 编译，已在 `imind/app/pubspec.yaml` 用 `dependency_overrides` 固定到 11.0.0。
- 登录使用现有邮箱验证码。本地 `.env` 已设置 `MULTICA_DEV_VERIFICATION_CODE`，开发环境可用任意邮箱加该验证码登录；不要把验证码写进客户端。
- iMind 录音走 `GET /api/imind/asr`。当前这次本地 API 进程已从用户的百炼 CSV 读入 `DASHSCOPE_API_KEY` 和 `DASHSCOPE_WORKSPACE_ID`，只放在进程环境里。原有 `/api/speech/realtime` 仍使用 Qwen3 实时模型。
- 本机 `/Applications/Docker.app` 已不存在，`/usr/local/bin/docker` 是断链。已改用 Homebrew 的 Colima 0.10.3、Docker CLI 29.9.2 和 Compose 5.6.1，并把 Docker context 切到 `colima`。调用时要把 `/opt/homebrew/bin` 放在 PATH 前面。2026-10-27 Colima 已启动，`make db-up` 已拉起 `pgvector/pgvector:pg17`，端口 `127.0.0.1:5432`。
- 本地验收用的共享根是独立 profile `imind-android` 上的 `multica-operate daemon`，目录 `/tmp/imind-knowledge`，机器名 `imindhost`。它和用户自己的默认 daemon 不是同一个进程。停掉这个 daemon 后，App 会再次看不到知识库。
- 百炼实时 ASR 的确切 WebSocket 鉴权、消息字段和音频格式必须以用户提供的官方文档为准，并以测试凭证在运行时验证；不要把 CSV 中的 API Key 提交到仓库。
