# iMind Flutter App — 方案、进度与接力

最后更新：2026-10-29（下一轮五项优化已交付，iOS 27 → Android 15 本地验收通过）

## 验收口径

**最新五项优化已完成：** iOS 27 → Android 15 各 7 项本地设备 E2E 通过，普通安装包重启恢复通过；真实 DeepSeek 自动标题/摘要和 AI 重命名通过。剪藏抓取回写使用本地受控执行器验收，未执行真实 Agent CLI。完整 Flutter 回归 134 项通过。最新证据及边界见 [OPTIMIZATION_VALIDATION.md](OPTIMIZATION_VALIDATION.md)。

依据 `imind/design/index.html` 的 18 个移动画板继续实现同一套 Flutter iOS/Android 客户端。接口由本地 Docker Multica 提供；复用现有工作区共享知识库；每条笔记为 `./iMind/<标题>.md`，UUID 保存在元数据，有 YAML 头部、唯一的正文和原文分隔符。AI+ 已替换为下文定义的文件专属 Agent 群聊。**iOS 以已完成的 iOS 27 验证为准，不再要求 iOS 16 环境或验收。** 生产环境验证作为补充证据，验证码登录 E2E 使用本地 Docker。

**当前结论：四项 P1 的功能实现已完成，iOS 27 / Android 模拟器的功能、动态验证码登录、原始音频新进程回放及普通安装包重启验证均已通过；Web 输入框与两端 Flutter 输入框的双向实时消息补验也已通过。** 图片与原始 WAV 通过共享 daemon 持久化；本地真实验证码登录、文件群聊、Web 设置和实时消息已有通过记录。用户确认仅使用模拟器，真机拍照与实际听音保留待补验。最新结果与检查边界统一记录在 [P1_VALIDATION.md](P1_VALIDATION.md)，下方保留此前验证记录以区分历史和本轮证据。

AI+ 流式语音输入也已完成：复用现有 record / AsrSession，partial 实时填入输入框，停止等待最终结果后可编辑、手动发送。iOS 27 / Android 模拟器的原生麦克风与真实 ASR 流式输入验收均通过；语音输入该轮完整 Flutter 回归为 125 项，静态分析及普通双端构建通过。证据见 [VOICE_VALIDATION.md](VOICE_VALIDATION.md)。真机采集与真人语音质量仍未补验。

- 接受现有 Markdown 源码编辑、格式工具栏和富文本预览与设计稿的差距，不要求改成所见即所得编辑器；补齐“拍照”和“选图”插入功能。
- 接受现有文件操作的并发边界，不增加统一写入仲裁、跨进程锁或句柄级文件系统隔离；保留已有 revision 冲突保护与 symlink 检查。

## 实现方案

1. `imind/app`：共享 Dart UI/逻辑；Android 和 iOS 仅负责原生权限、网络与安全存储。Markdown 源码编辑、格式工具栏、预览、撤销重做；录音详情在同一编辑会话保存笔记和时间戳原文。
2. `server/internal/imind`：笔记模型与文件编码；`server/internal/handler/imind*`：认证、成员、共享根、CRUD、媒体、ASR 与文件群聊接口；新增文件群聊映射表、工作区默认智能体配置和评论幂等/分发状态字段。
3. 笔记落在实际共享根的一级物理 `iMind/`。文件名是标题的唯一来源，修改标题时重命名，重名追加数字。拒绝重复/越界分隔符、畸形头部、非法音频和 URL、非 UUID-v4、静态 symlink 文件与目录。
4. `fileshare` 新增可选 `scope: imind` 和 daemon 能力 `imind_scope_revision_v1`。旧 daemon 可继续服务通用 docs，但 iMind 不静默降级，要求升级。
5. 读取、更新和删除使用 revision。删除在 daemon 与文件更新相同的路径锁中再次比较 SHA-256。此保证只覆盖同进程、协作写入，不覆盖任意直接磁盘写入；这是已接受的实现边界。
6. `lib/session.dart`：安全存储单一 `imind_session`，包含 API 根、token、工作区 UUID、共享 machine；绑定 API 根。401/退出立即撤销已登录路由栈并清理凭据。旧无绑定字段不迁移，需要重新登录。
7. `lib/asr_session.dart`：升级头带 Bearer 与 `X-Workspace-ID`，query 仅带 share_machine；首帧 16 kHz 单声道 pcm_s16le；等 ready 后采集，stop 后继续等待 final/done 才保存；断线、超时显示可恢复错误。暂停后重连保持累计时间和独立句 ID。服务端使用指定 `qwen-audio-3.1-asr-flash-message`，密钥仅服务端环境。
8. 正则网页剪藏截断中文标点及说明，保留查询参数与平衡括号；先保存原文、URL 和提示词占位文件，再在同一文件群聊分发抓取回写。AI+ 复用已有评论、JEV、任务与 WebSocket；AI 命名与录音自动标题摘要共用服务端 DeepSeek。

详细契约见 [CONTRACT.md](CONTRACT.md)。

## 此前已完成及验证证据

- [x] 补齐客户端 workspace 请求头、授权列表选择与安全会话持久化；网络超时、畸形响应、401、旧会话并发结果均有回归。
- [x] 所有 `/api/imind/*` 路由在认证及工作区成员保护内；升级前授权 ASR；移除首帧 token 的错误接线。
- [x] 修复原有 URL 提取测试；修复原文只读第一行及长录音时间戳截断；多行 Markdown 和毫秒往返测试通过。
- [x] 修复录音保存抢在最后 final 到达之前、暂停后句 ID/时间冲突和错误连接状态。
- [x] 补齐物理 iMind scope、daemon 能力协商、删除 revision 比较；通用 docs 保持原语义。
- [x] 已读取最终任务 `bby5lc` 的完整真实输出：格式化 2 个文件无改动、`flutter analyze` 无问题、完整 `flutter test --concurrency=1` 106 项通过、Android Debug APK 构建成功。该轮覆盖最新 ASR ready 错误消费和 HTTP 授权预检补丁。需要仅对测试命令清除 HTTP(S)/ALL_PROXY，NO_PROXY 包含 localhost/127.0.0.1/::1。
- [x] `go test -race ./internal/fileshare ./internal/obsidianvault ./internal/imind ./internal/imindasr` 通过。
- [x] `go test ./internal/handler -run 'Test(IMind|Docs|FileShare)' -count=1`：数据库可用的相关 handler 回归通过。
- [x] `git diff --check` 通过。没有运行全仓前端、全量 Go、Playwright；没有修改 xiaohongshu 的用户改动。
- [x] 本地 Docker API 镜像 `multica-imind:local` 已重建，backend 与 pgvector 容器实际运行；健康响应 status=ok。数据库沿用当前受管理 checkout 的 `multica_multica_527`，未重置数据。
- [x] 编译并运行新版 `server/bin/imind-operate`，共享根为项目内 `imind`，machine=`imindhost`，visibility=workspace，独立本地 profile=`imind-android`，workspace=`imind-validation`。
- [x] `python3 imind/verify_contract.py`：最新版容器与 daemon 上 14 项实联调通过。认证、缺 workspace、路径穿越、分隔符注入、三类笔记创建读取、物理 Markdown、原文/笔记一起更新、冲突、标签筛选均验证；样例保留在专用验收共享根，未删除用户文件。
- [x] Android Debug APK 构建、模拟器安装和打开登录页通过；当前最终 APK：`imind/app/build/app/outputs/flutter-apk/app-debug.apk`。JDK 使用既有 Homebrew openjdk@17，避免失效的系统 JAVA_HOME。
- [x] Android 15 专用 `imind_e2e_api35` 模拟器完成主流程 2 项、功能 3 项、时长 1 项集成测试；编辑、剪藏、删除、筛选、标签、撤销重做、录音详情双编辑及真实 revision 冲突保护通过。普通 APK force-stop 后不同 PID 重启并恢复已登录首页。此前 `imind_pixel6` ANR 已不构成当前验收阻塞，旧设备数据保留。证据：[Android 验证记录](../outputs/imind/android-validation.md)。
- [x] 新增可复用 `imind/verify_android_device.py`，凭据仅运行时内存读取。收尾补齐防误判：必须看到当前 App 的“菜单/录音/笔记”首页控件，重启另须确认不同 PID；不能仅凭登录页消失算通过。脚本语法及 4 个首页状态检查用例通过；这些不是设备级通过证据。
- [x] iOS 完整模拟器构建成功：`outputs/imind/ios27-final-build.log`。iOS 27.0 完成笔记编辑保存、AI+ Mock、删除、剪藏、原生麦克风启动与录音保存；真实模型识别及 Markdown 回读另有通过记录。证据：[iOS 27 验证记录](../outputs/imind/ios27-validation.md)。早期 `ios-build.log` 的失败不再作为当前阻塞。
- [x] 本地 iOS 27、Android 和生产 Android 均有真实 ASR 通过记录；早期缺少凭据的 503 已有后续成功验证。原生麦克风采集与合成语音识别分别验证，不能据此宣称真人讲话的识别质量已验收。
- [x] iOS 27 与 Android 均完成约 3 分钟真实 ASR 录音、暂停/续录、手动停止、伴随笔记保存及时间戳回读；不代表小时级或中断恢复已验证。
- [x] 生产 Android 共 6 项集成用例通过，普通 APK 进程重启后会话恢复通过。证据：[生产验证记录](../outputs/imind/production-validation.md)。这些用例通过预置会话跳过验证码登录，不覆盖下文新增登录待办。

以下 P1 本轮新增原始 WAV 持久化与播放；以上历史记录中的“录音保存”仅指转写、伴随笔记和音频时长等元数据保存，不包含原始音频文件保存或回放；播放按钮禁用状态通过测试也不代表回放已实现。

## 本地启动和复验

```sh
# 在仓库根执行；使用受管理的现有 checkout 数据库
PATH="/opt/homebrew/bin:$PATH" colima start
PATH="/opt/homebrew/bin:$PATH" make db-up
# 首次或需要迁移时用 make up C=api 初始化当前 checkout；不要人工猜数据库
# 若受管理 API 已占用 18607，先 make down 停止本 checkout，保留数据
PATH="/opt/homebrew/bin:$PATH" docker compose --env-file .env -f imind/docker-compose.yml up -d --build

go -C server build -o bin/imind-operate ./cmd/multica-operate
# 本地测试 profile 已设置。新环境必须自行登录并选择可访问 workspace
# 只启 file-share daemon，不启动或执行真实 agent CLI
server/bin/imind-operate --profile imind-android daemon start --foreground

/Users/tao/.workbuddy/binaries/python/versions/3.13.12/bin/python3 imind/verify_contract.py
```

脚本只允许 loopback 本地 API，运行时读取专用 profile，不输出 token；生成 `outputs/imind/contract-results.json`。每次会新增 3 条专用验收样例，不自动删记录。

Flutter 验证与 Android 构建（在 `imind/app`）：

```sh
flutter analyze
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy NO_PROXY=localhost,127.0.0.1,::1 flutter test --concurrency=1
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home flutter build apk --debug
flutter build ios --simulator --debug
```

客户端默认 API 为 `https://chat.preview.aliyun-zeabur.cn`；本地验收通过 `--dart-define=API_BASE=...` 覆盖，iOS 模拟器使用 `http://127.0.0.1:18607`，Android 模拟器使用 `http://10.0.2.2:18607`，真机使用可访问的服务地址。Android Debug/Profile 仅放开本地地址明文；iOS仅启用本地网络 ATS，不全局关闭传输保护。iOS 最低部署版本维持 15.0；验收环境使用 iOS 27，不需要安装或验证 iOS 16。

## 待办与验收标准

### P1：拍照与选图插入（必做）

- [x] 在普通笔记与录音边录边记的共用编辑器中补齐“拍照”“选图”入口，录音详情的笔记编辑沿用同一能力。
- [x] 打通相机/照片权限、拍摄或选择、图片持久化及 Markdown 图片引用；保存后重新打开可显示，不能只引用临时文件。
- [x] 明确图片与共享知识库的存储、访问契约，并同步更新 CONTRACT；保证笔记在 iOS/Android 重新读取时图片可访问。
- [x] 验证取消选择、拒绝权限、插入失败的反馈和原有文字保留；在 iOS 27 与 Android 验证插入、预览、保存、重开及撤销重做。
- [ ] **用户确认延期补验：** 相机采集需使用支持相机的真机；模拟器注入图片不算拍照通过。

现有 Markdown 源码编辑、格式工具栏、富文本预览形态已接受；无需为贴近设计稿重做编辑器。

### P1：本地 Docker 验证码登录 E2E（必做）

- [x] 新增独立登录用例，连接 `imind/docker-compose.yml` 启动的本地 backend 和当前 checkout 的受管理 PostgreSQL；使用专用测试账号与验收共享目录。
- [x] 从未登录状态在 App 输入邮箱并点击发送验证码，实际经过 `POST /auth/send-code`。记录本次请求时间，随后从本地 Docker 的 PostgreSQL 容器读取该邮箱本次生成的 `verification_code` 记录，筛选未使用、未过期且属于本次请求的最新验证码。
- [x] 通过 Docker 容器执行数据库查询，数据库名和连接信息取自当前 checkout 环境；不猜数据库、不改指向其他环境。验证码仅保留在测试进程内存，不打印到日志或写入仓库。
- [x] 将读取到的验证码填入 App 并提交，实际经过 `POST /auth/verify-code`；选择授权工作区和共享目录，进入首页后读写测试笔记。
- [x] 验证退出登录、重走验证码登录，以及普通 App 进程重启后安全会话恢复；补充错误验证码反馈。iOS 27 和 Android 分别记录结果。
- [x] 调整现有 E2E 入口，使上述登录用例可重复运行并保留成功/失败证据；现有预置 token 的功能用例可保留，但不能计为验证码登录通过。

此验证只读取本地 Docker 中生成的验证码，不依赖真实邮箱收件，不需要生产环境验证码，也不能硬编码固定验证码绕过登录流程。验证码表与有效性条件参考 `server/pkg/db/queries/verification_code.sql`。

### P1：原始录音保存与回放（必做）

- [x] 实现原始录音持久化与录音详情回放；当前仅存转写及音频元数据、播放按钮禁用的实现不满足此要求。
- [x] 明确音频文件在共享知识库中的存储、上传/读取、授权及与笔记关联的契约，更新 CONTRACT 和客户端说明；支持保存后退出页面、重启 App 再打开播放，不能依赖临时录音文件或内存缓存。
- [x] 在 iOS 27 与 Android 验证“麦克风录音 → 暂停/续录 → 停止 → 保存 → 重开详情 → 回放”完整链路，同时确认转写和伴随笔记正确保存，首尾音频与暂停前后内容保留。
- [x] 验证播放、暂停、继续、播放结束状态与时长/进度显示；持久 WAV 字节与原生播放控制已验证。
- [ ] **用户确认延期补验：** 通过实际音频输出确认内容可听且与录制内容一致；进度变化与字节相同不能替代实际听音。
- [x] 验证保存失败时的重试和录音保留，以及音频缺失、读取失败时的错误反馈；旧的无音频笔记应明确显示不可播放。
- [x] 为保存、持久化后读取及播放控制补充自动化回归，并记录设备回放结果；现有真实 ASR 与合成 PCM 测试不能替代原始录音保存和回放验证。

### P1：AI+ 文件专属 Agent 群聊（必做，替换本地 Mock）

#### 文件、群聊与成员

- [x] 每个已保存的 md 文件首次展开 AI+ 时，创建对应的专属群聊 issue；后续展开复用同一个群聊和历史。不同文件创建不同群聊，不按用户、设备或每次展开重复建群。
- [x] 服务端持久化文件与群聊的关联，以工作区、共享根身份和笔记元数据 UUID 确定文件身份，不能仅绑定会变化的文件名。重命名后复用原群聊；多个用户同时首次展开时，创建与加入必须幂等。
- [x] 展开聊天框即将当前用户加入该群聊，加入成功后拉取历史并接收实时事件；关闭聊天框只关闭界面，不删除群聊或自动退出成员关系。所有具备当前工作区及对应 md 文件访问权限的用户均可自行加入，无需创建者邀请；“所有人”不扩大原有文件访问范围。
- [x] 新建但尚未保存的笔记先成功保存，取得稳定文件身份后再建群；保存失败保留草稿并反馈。群聊上下文包含对应 md 的可访问引用；发送时明确使用已保存版本或当前编辑内容，保留 revision，避免将未保存修改误称为已落盘内容。
- [x] 文件专属群聊复用 Multica 现有 group-chat issue、成员、消息与运行体系，Web 后台和 Flutter 看到同一份历史与执行状态。

#### 默认处理 Agent 与 JEV 分发

- [x] 用户可在 Multica Web 后台配置 iMind 默认处理 Agent；配置由服务端读取，Flutter 无需选择或强指定 Agent。配置的归属范围、读写权限与响应 schema 在实现时明确并写入 CONTRACT，不能假设已有专用设置。
- [x] 有默认配置时，由服务端按权限校验将该 Agent 加入群聊并触发回答；无配置时走现有 JEV 分发流程，自动选择合适 Agent、加入群聊并处理消息。
- [x] 复用已有分发和运行调度，不在 Flutter 复制 Agent 选择逻辑。配置失效、无合适 Agent、Agent 不可用或 JEV 分发失败时显示可恢复状态；保留用户消息与重试入口，不伪造回复或退回本地 Mock。

#### Flutter 消息与 md 卡片

- [x] 用真实群聊消息替换 `_AiSheet` 的本地 Mock；发送展示 pending 状态，失败可重试并避免重复消息，支持历史分页与重开恢复。
- [x] 对齐 Web 的 Markdown 消息渲染及 md 文件卡片解析和样式，特别是 `docs` / `obsidian` fenced JSON 中的 `name`、`summary`、`path`：卡片标题、摘要、文件标识、间距、截断及点击打开行为与 Web 一致；未知或畸形卡片降级显示可读内容。
- [x] 对齐 Web 的相对 md 路径校验、缺省标题及摘要处理，禁止绝对路径与路径穿越；卡片打开走现有文档授权接口，不把服务器或 daemon 的磁盘路径直接交给端侧打开。

#### WebSocket 与红色终止按钮

- [x] Flutter 接入 Multica WebSocket，使用登录身份和工作区上下文，按当前群聊 issue 过滤事件；处理消息新增、修改、删除、成员变化与任务排队、运行、完成、失败、取消，更新真实消息及运行进度。
- [x] 断线后重连并重新拉取历史/活动运行，按消息和运行 ID 去重；切换文件、工作区、退出登录或关闭弹层时正确管理监听，避免串群、重复订阅及遗漏重连期间的消息。
- [x] Agent 存在可终止的活动运行时，提供与 Web 行为一致的红色终止按钮；绑定该群聊的具体运行并调用现有任务取消接口，不能取消 Agent 在其他群聊的运行。
- [x] 点击后进入“正在终止”状态并防止重复提交；通过服务端响应和后续运行事件收敛为已取消或已完成。请求失败保留可重试反馈；保留已有回复和历史，不把本地隐藏加载状态当作终止成功。多 Agent 场景明确每个终止按钮对应的运行。

#### 验收与实现参考

- [x] 在本地 Docker、iOS 27 和 Android 验证两名用户展开同一 md 自动加入同群、重开与重命名复用、不同 md 隔离；在 Web 后台能看到相同群聊及消息。
- [x] 分别验证后台默认 Agent 回答、未配置时 JEV 自动选 Agent 加群回答，以及无可用 Agent/分发失败。实际 Agent 执行测试须遵守仓库的显式授权与隔离要求，普通回归使用受控假执行器。
- [x] 验证 Web 发消息后 Flutter 实时更新及反向同步、断网重连补齐、切群不串消息、Markdown/md 卡片显示与打开、红色按钮实际终止对应运行且其他群聊不受影响；保留日志及截图。**实时 API/WS、两端卡片与重连、受控执行器取消隔离均通过；Web 输入框实际发消息到 iOS / Android Flutter、Flutter 输入框回发及 Web 实时显示均通过。日志与截图见 P1_VALIDATION。**
- [x] 更新 CONTRACT 中群聊绑定、加入、默认 Agent 设置、消息、WebSocket、取消与上下文契约，并补服务端及 Flutter 回归。历史 AI+ Mock 测试通过不算本方案完成。

参考现有实现：

- `server/internal/handler/group_chat.go`：群聊 issue、成员和消息访问。
- `server/internal/handler/group_chat_dispatch.go`、`server/internal/groupchat/`：JEV 分发。
- `packages/core/group-chats/use-group-chat-realtime.ts`：`comment:created/updated/deleted`、`group_chat:updated`、`task:queued/running/completed/failed/cancelled` 与重连刷新。
- `packages/views/rich-content/doc-note.ts`、`doc-note-card.tsx`、`packages/views/im/chat-documents.ts`：md 卡片解析、样式与路径规则。
- `packages/views/im/chat-thread.tsx`：活动运行进度及取消；`packages/core/api/client.ts` 的 `cancelTask`：issue 范围内的运行取消接口。

### 其他待补验证

- [ ] 真人讲话经原生麦克风、真实 ASR 到笔记保存回读的完整链路与识别质量。
- [ ] 小时级录音，以及锁屏、切后台、来电、断网/重连和进程终止后的行为与恢复；现有约 3 分钟测试不覆盖这些场景。
- [x] AI+ 语音输入：复用录音页 record / AsrSession 与实时 ASR，partial 流式填入输入框，停止排空 final 后可编辑并手动发送；iOS 27 / Android 原生麦克风与真实 ASR 流式输入验收通过，见 [VOICE_VALIDATION.md](VOICE_VALIDATION.md)。AI 命名已由下一轮优化替换为服务端 DeepSeek，见 [OPTIMIZATION_VALIDATION.md](OPTIMIZATION_VALIDATION.md)。

### 后续发布准备

- [ ] 如需正式分发，配置 Android release 签名并验证正式构建；当前 release 配置仍使用 debug 签名。
- [ ] 如需 iOS 真机分发，补齐签名、归档与分发验证；模拟器构建成功不代表分发完成。

以上发布项按正式分发需求推进，不替代当前四项必做功能与验证。

## 下一轮功能优化待办

2026-10-29 记录。下列五项代码已实现，最终本地设备验收与真实上游调用边界见 [OPTIMIZATION_VALIDATION.md](OPTIMIZATION_VALIDATION.md)。它们替换此前「AI 命名保持 Mock」和「网页剪藏只保存 URL、不抓取正文」这两条已接受边界；导出与回收站恢复仍然不做。

- [x] **输入框底部安全区。** 贴底输入框此前只处理键盘 `viewInsets`，或再加一段固定间距，收起键盘后仍贴着 Home 指示条。笔记编辑、录音、AI+ 输入和剪藏弹层都要同时考虑底部安全区：键盘弹起用 `viewInsets.bottom`，键盘收起用 `viewPadding.bottom`，取较大值，不能只用固定 24。
- [x] **AI 消息上的查看与终止。** 对齐 Web IM，不要把终止放在聊天顶部。Web 的进行中回复在 `packages/views/im/chat-thread.tsx` 的 `ThinkingBubble` 上提供「查看」（`thread.view_progress`）；手机端经 `onOpenProgress` 进入 `packages/views/im/chat-progress-view.tsx` 的二级页，展示该次运行的执行过程，返回用页面自己的返回。终止调用现有 `POST /api/issues/{id}/tasks/{taskId}/cancel`，按钮放在对应 Agent 消息上，并在执行详情页保留；每个按钮只取消该消息绑定的运行。Flutter 此前把活动运行和红色终止放在消息列表上方的横幅（`imind/app/lib/ai_chat.dart` 的 `_runRow`），本轮已改为对应消息上的操作。提交中进入「正在终止」，失败可重试，不把本地加载态当成已取消。
- [x] **语音笔记自动标题，并允许手改。** 录音保存后由服务端立刻调用 DeepSeek 生成标题和摘要。标题仍是文件名的唯一来源，用户可以随后手动修改，重名规则不变。DeepSeek API Key 只在管理后台配置，不进客户端，不进仓库。请求 `https://api.deepseek.com`，使用快速非思考模式：`thinking.type = disabled`，`reasoning.effort = low`。未配置 Key 时保留可恢复提示，不伪造标题。
- [x] **AI 重命名走同一条 DeepSeek 调用。** 把该 md 的已保存内容读出，交给 DeepSeek 生成文件名，仍用上面的非思考参数和后台 Key。生成结果按现有重命名契约落盘；用户可以再改。失败保留原文件名并给出可重试反馈。
- [x] **网页剪藏改为占位文件加同一条 AI+ 群聊。** 流程是：先创建文件，元数据标记类型为剪藏，保存用户原始粘贴文本和正则提取出的链接；标题先用默认名，例如「生成中的剪藏1」。文件创建成功后，打开这个文件自己的 AI+ 群聊，与用户手动点开的是同一个会话，不另建一套聊天。把「iMind 默认处理智能体」和「iMind 剪藏智能体」拉进群；剪藏智能体与默认智能体一样在管理后台指定，未指定时由 JEV 分发一个 Agent 处理。用户除链接外可以附上一段可选提示词，把链接和提示词合并后发给模型，由模型剪藏并回写这个占位文件。保存失败时不建群；回写失败保留占位文件和可重试入口。

## 已接受的边界与非目标

- 不再要求 iOS 16 验收，以 iOS 27 验证为准。
- 接受现有编辑器与设计稿的差距；本次仅补拍照和选图插入能力。
- 不做并发文件操作强化。保留同 daemon 路径锁、revision 比较和现有 symlink 检查；外部直接写盘或第二 daemon 不协作时仍有并发窗口，Lstat 与后续操作间仍有 symlink 替换窗口。这些限制不再列为开发阻塞。
- 导出、回收站恢复当前不可用。AI 命名 Mock 和「剪藏只存 URL」不再是接受边界，改由上一节的待办替换。AI+ 对话保持文件专属 Agent 群聊。
- 原始录音保存与回放已实现；媒体授权和存储以 CONTRACT 的图片与原始音频章节为准。

## 接力规则

每次接力先看本文件和 CONTRACT，再检查实际容器、授权、runtime 与构建结果。验证状态以对应环境的最新日志为准：早期构建失败、模拟器 ANR、ASR 缺配置的记录仅作为历史证据，不覆盖后续成功结果。

本轮 P1 的实现与验收记录见 P1_VALIDATION。「下一轮功能优化待办」的实现和本地验收见 OPTIMIZATION_VALIDATION；真实 DeepSeek 成功调用与逐端结果以该报告为准，真机拍照与实际听音保留补验。每次记录代码变更、实际执行的检查、设备与环境、结果及剩余限制；没有执行的测试保持未完成，不因已有预置会话用例通过而勾选验证码登录，也不因转写保存或禁用播放按钮测试通过而勾选音频保存与回放。无需恢复 iOS 16 验收、重做编辑器或扩展并发文件保护。
