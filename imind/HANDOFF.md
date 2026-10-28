# iMind Flutter App — 方案、进度与接力

最后更新：2026-10-28（本轮从 2026-10-27 晚间开始）

## 验收口径

依据 `imind/design/index.html` 的 18 个移动画板继续实现同一套 Flutter iOS/Android 客户端。接口必须由本地 Docker Multica 提供；复用现有工作区共享知识库；每条笔记为 `./iMind/<标题>.md`，UUID 保存在元数据，有 YAML 头部、唯一的正文和原文分隔符。AI+ 仅 Mock。最终必须在 **iOS 16 模拟器**自验证；旧交接中“改用 Android 作为最终通过条件”的说法已撤销。

**当前结论：功能和契约回归已通过，Android 构建及安装已验证；整体未验收完成。iOS 16 运行时和本轮真实 ASR 验证仍阻塞。** 不以 iOS 27、Android 或编译目标版本替代 iOS 16 验收。

## 实现方案

1. `imind/app`：共享 Dart UI/逻辑；Android 和 iOS 仅负责原生权限、网络与安全存储。Markdown 源码编辑、格式工具栏、预览、撤销重做；录音详情在同一编辑会话保存笔记和时间戳原文。
2. `server/internal/imind`：笔记模型与文件编码；`server/internal/handler/imind*`：认证、成员、共享根、CRUD 与 ASR 接口；不新增数据库表。
3. 笔记落在实际共享根的一级物理 `iMind/`。文件名是标题的唯一来源，修改标题时重命名，重名追加数字。拒绝重复/越界分隔符、畸形头部、非法音频和 URL、非 UUID-v4、静态 symlink 文件与目录。
4. `fileshare` 新增可选 `scope: imind` 和 daemon 能力 `imind_scope_revision_v1`。旧 daemon 可继续服务通用 docs，但 iMind 不静默降级，要求升级。
5. 读取、更新和删除使用 revision。删除在 daemon 与文件更新相同的路径锁中再次比较 SHA-256。此保证只覆盖同进程、协作写入，不覆盖任意直接磁盘写入；详见风险。
6. `lib/session.dart`：安全存储单一 `imind_session`，包含 API 根、token、工作区 UUID、共享 machine；绑定 API 根。401/退出立即撤销已登录路由栈并清理凭据。旧无绑定字段不迁移，需要重新登录。
7. `lib/asr_session.dart`：升级头带 Bearer 与 `X-Workspace-ID`，query 仅带 share_machine；首帧 16 kHz 单声道 pcm_s16le；等 ready 后采集，stop 后继续等待 final/done 才保存；断线、超时显示可恢复错误。暂停后重连保持累计时间和独立句 ID。服务端使用指定 `qwen-audio-3.1-asr-flash-message`，密钥仅服务端环境。
8. 正则网页剪藏截断中文标点及说明，保留查询参数与平衡括号；仅保存 URL，不抓取网页正文。AI+ 不调用模型。

详细契约见 [CONTRACT.md](CONTRACT.md)。

## 本轮完成及真实验证

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
- [ ] 本轮 Android 设备交互补验仍阻塞：专用 AVD `imind_pixel6` 初始系统 ANR；保留数据冷启动后确认 `boot_completed=1` 并再次看到登录页，但随后登录助手、独立 UI 查询及 App force-stop 均超时。未确认登录、跨进程持久化、编辑或剪藏通过；故障模拟器已正常停止，未 wipe、清 App 数据或删除 snapshot。结果为 `outputs/imind/android-device-results.json`，冷启动截图为 `android-device-02-cold-start.png`。原有 6 条样例哈希不变。
- [x] 新增可复用 `imind/verify_android_device.py`，凭据仅运行时内存读取。收尾补齐防误判：必须看到当前 App 的“菜单/录音/笔记”首页控件，重启另须确认不同 PID；不能仅凭登录页消失算通过。脚本语法及 4 个首页状态检查用例通过；这些不是设备级通过证据。
- [ ] iOS App 完整构建未成功，不能交付残缺 Runner.app。详见下文；构建日志在 `outputs/imind/ios-build.log`。
- [ ] iOS 16 模拟器最终验收未通过。
- [ ] 本轮真实模型 ASR 未重跑：当前服务端未配置 DASHSCOPE 凭据，接口正确返回 503。客户端/代理协议通过真实本地 WebSocket 假上游测试，不冒充真实模型。旧交接曾有真实模型成功记录，仅作历史信息。

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

模拟器默认 API：iOS `http://127.0.0.1:18607`、Android `http://10.0.2.2:18607`；真机通过 `--dart-define=API_BASE=...` 配置可访问服务地址。Android Debug/Profile 仅放开本地地址明文；iOS仅启用本地网络 ATS，不全局关闭传输保护。iOS最低部署版本 15.0，可覆盖 iOS 16，但不代表在 iOS 16 上验证过。

## 阻塞与遗留待办

### P0：iOS 16 验收环境

- 本机 Xcode 27.1，已安装 iOS 27.0/27.1 runtime，没有 iOS 16。
- `xcodebuild -downloadPlatform iOS -buildVersion 16.4` 实际返回 `iOS 16.4 is not available for download.`
- Apple 官方矩阵指出 Xcode 27.1 Simulator 支持 iOS 17 及以上：https://developer.apple.com/support/xcode/ 。需提供支持 iOS 16 的 Xcode/宿主环境与官方 iOS 16 runtime，不能把 deployment target 当验收。
- 本轮已启动 iOS 27 模拟器用于补充排障，但 App 未成功运行。

### P0：iOS 原生构建工具选择

- 旧 SwiftPM 的 `sandbox_apply: Operation not permitted` 已通过官方项目级 CocoaPods 路径排除；pubspec 明确禁用 SwiftPM，并移除已有 package 引用/preaction。不修改用户全局 Flutter 配置。
- 仍被 `objective_c` 官方 native-assets hook 阻塞：hooks_runner 白名单不传 DEVELOPER_DIR；过滤环境的 xcode-select 实际指向 CommandLineTools，xcrun 找不到 simulator SDK，hook 抛出 `Bad state: No element`。
- 当前 shell 的 DEVELOPER_DIR 指向完整 Xcode，所以普通 flutter doctor 和 shell xcrun 成功会误导。对照日志确认完整环境下官方 hook 可编译原生库，但整个 App 仍不完整；xcodebuild真实退出码65。
- 非提权 `xcode-select --switch` 要求 root，非交互 sudo 被本运行环境拒绝。本轮再次确认 `env -u DEVELOPER_DIR xcode-select --print-path` 仍是 `/Library/Developer/CommandLineTools`；过滤环境 SDK 查询仍失败。只读审查确认当前官方 objective_c hook 不提供开发目录/SDK 的项目 user_defines 配置，Flutter 也不开放项目级 hook 环境透传；不再反复尝试 shell 环境覆盖。
- 需要宿主管理员协调执行 `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`（影响系统其他 Xcode 工作流；本轮未执行）。随后先验证 `env -u DEVELOPER_DIR xcode-select --print-path` 与 `env -u DEVELOPER_DIR xcrun --sdk iphonesimulator --show-sdk-path` 均成功，再正常构建。此步骤不补齐 iOS16运行时。不要编辑第三方包缓存、伪造 SDK/编译产物或把工具 completed 当作成功。

### P0：真实 ASR 复验

- 本轮 2026-10-28 01:59（+08）再次仅输出配置布尔值确认：运行中 Docker backend 的 `DASHSCOPE_API_KEY` 和 `DASHSCOPE_WORKSPACE_ID` 均为空。请仅在私有服务端配置注入后重启 Docker backend；不能把凭据写入 Dart define、文档或提交仓库。
- 配好后真设备或可控音频输入验收：ready → partial → final → stop → done → Markdown 写入，确认毫秒时间戳与末句不丢。本版不保存原始音频文件。

### P1：并发强保障与编辑体验

- 路径锁仅同 daemon 进程；外部编辑器直接写磁盘或第二 daemon 不协作。revision 比较后删除前仍有外部写入窗口。
- 物理 scope 的 Lstat/随后文件操作之间仍存在并发 symlink 替换 TOCTOU；现实现拒绝检查时已存在的链接，不是句柄级沙箱。
- 如需对恶意/不协作外部并发给强保证，需要统一写入仲裁及句柄相对文件系统操作，不能仅靠可选 JSON 字段或进程内锁。
- Markdown 当前为源码+格式栏+富文本预览，不是完全 WYSIWYG 富文本编辑器；以真实 iOS16键盘、选择、撤销、长文滚动补验。
- 回收站、导出未实现；AI+ 必须保持 Mock，不扩成真实模型功能。

## 接力规则

每次接力先看本文件和 CONTRACT，再检查实际容器、授权、runtime与构建结果。只勾选本轮确实完成的事项，区分历史证据、假上游测试和真实模型验证。完成 iOS16与真实ASR前，不宣称整体验收通过。
