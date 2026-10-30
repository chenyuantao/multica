# 2026-10-30 交互、标签与语音输入检查

本轮 11 项实现见 [HANDOFF.md](HANDOFF.md)，接口及筛选语义见 [CONTRACT.md](CONTRACT.md)。由三个 GPT-6.1 Terra 子代理分别实现首页、详情与编辑、服务端/API，主代理整合审查。未部署生产环境；首次实现时未运行 E2E，最新 iOS 验收见下文。未运行真实 Agent CLI。


## 最新验收：iOS 27 E2E（2026-10-30）

按用户要求仅验证 iOS。设备为 iPhone 18 Pro / iOS 27.0，UDID `909E49E1-83F4-4A69-91C0-0F8D43EE88E0`。使用本地 Docker API `http://127.0.0.1:18607`、当前 checkout 的受管理数据库、`imind-validation` 工作区和 `imindhost` file-share daemon；重建了本地 backend 与 daemon，未连接生产环境。

`integration_test/interaction_e2e_test.dart` 最终完整运行 **7/7 通过**，日志末尾为 `02:54 +7: All tests passed!`。证据：[结果 JSON](../outputs/imind/ios-interaction-p1-results.json)、[完整日志](../outputs/imind/ios-interaction-p1.log)。此前失败日志保留为 `ios-interaction-initial/second/third*`，不作为通过证据。

| 本轮验收项 | 实际验证及结果 |
| --- | --- |
| 编辑入口与返回 | 笔记、剪藏、录音三类详情的标题/正文点击均保持阅读；菜单进入编辑；真实 iOS 路由边缘拖动返回。编辑边缘拖动弹确认，取消留稿，确认放弃和顶部放弃均完整退出详情；API 回读确认草稿未落盘。通过。 |
| 首页剪藏入口 | 底部栏中央「剪藏」位于录音与笔记之间，实际打开剪藏弹层；顶部更多菜单无旧入口。通过。 |
| 顶部标题 | 菜单右侧的 iMind 使用与详情相同的 17px 标题样式。通过。 |
| 提示词标签上下文 | 服务端 `TestIMindPromptOverridesReachNamingAndAgentContext` 验证已有 hashtag 列表进入默认/覆盖模板及文件 Agent 上下文；这是受控后端回归，未执行真实 Agent CLI 回写。 |
| 字号 | 笔记/剪藏 Markdown 普通段落与编辑正文均为 16px，录音编辑正文沿用共用编辑器。通过。 |
| 原生大图 | 真实媒体上传、授权读取与实际图片触摸打开 `QLPreviewController`；原生 UI 工具触摸 Done，断言 Done 消失，返回后详情菜单仍可操作。通过。 |
| 下拉刷新 | App 启动后经 API 新建笔记，下拉后出现；切到空筛选结果，再新增匹配录音，下拉后出现。通过。完全空知识库的首页引导态另有组件回归，不冒充本次设备覆盖。 |
| 手动标记 | 详情选已有「学习」和添加「手建标签」，真实 API 回读标签与更新后的 revision。通过。 |
| AI 标记 | 详情菜单及首页长按均实际调用本地 backend 的真实 DeepSeek；合并多个标签，保留原标签、标题和正文。并发写入后旧 revision 返回 409，保留并发正文；再次从首页操作成功。通过。 |
| 多标签筛选 | 横向胶囊同时选两项显示 OR 并集，再点取消一项；titlebar 取消清空标签，保留笔记类型筛选。通过。 |
| 编辑语音 | 编辑工具栏无旧 AI+/标签入口；原生麦克风真实 ready/启动/停止。用按实时速率送出的合成中文 PCM 经真实 ASR，识别中替换指定选区并保留前后文、正文只读且格式禁用；录音中直接保存会停止采集并保存识别内容，API 回读正确。受控权限拒绝保稿；实际重启本地 backend 触发 WebSocket 断线，保留已识别内容，恢复编辑后重试成功；语音中顶部放弃退出，录音定时器/流释放且草稿未保存。通过。 |

### 验收中修复

原实现直接呈现 Quick Look，iOS 27 上实际显示图片但无关闭导航控件，返回手势也未退出。本次将系统查看器放入原生 `UINavigationController`，增加系统 Done 操作，并只关闭对应的预览控制器。修复后使用原生触摸实际关闭并回到详情。证据：[原生结果](../outputs/imind/ios-interaction-native-results.json)、[修复后查看器](../outputs/imind/ios-interaction-native-viewer-fixed.png)、[关闭后详情](../outputs/imind/ios-interaction-native-return.png)。

新用例初轮还修正了旧标签文案定位、RawTooltip 与 IconButton 的定位区别、列表排序/刷新可见性，以及异步标签弹窗和写入完成的等待条件；最终全套通过后才记录验收完成。

### 回归与边界

- Flutter 定向组件/单元回归 **34 项通过**：`widget_test.dart`、`home_test.dart`、`voice_input_test.dart`、`media_editor_test.dart`。覆盖完整空首页刷新等待、final 排空与去重、权限/断线/销毁后晚到事件等。日志：[interaction-flutter-tests.log](../outputs/imind/interaction-flutter-tests.log)。
- `make env-exec ARGS='-- go -C server test ./internal/handler -run "TestIMind(Naming|Tag|Prompt)" -count=1 -v'` 通过；包括已有标签上下文、模型请求参数、标签保留/去重、输出校验及 revision 保护。上游错误与畸形输出使用替身，设备成功路径使用真实 DeepSeek。日志：[interaction-go-tests.log](../outputs/imind/interaction-go-tests.log)。
- `flutter analyze` 无 error/warning，保留 `lib/main.dart:1337` 既有 `curly_braces_in_flow_control_structures` info；没有为本次验收修改该代码。日志：[interaction-analyze.log](../outputs/imind/interaction-analyze.log)。
- Python runner 语法检查、`git diff --check` 通过。普通 iOS Debug 构建与重启恢复结果见下方收尾记录。
- 本次仅模拟器；原生采集和可重复的合成 PCM 识别分别验证，不代表真人讲话的识别质量。权限拒绝通过录音平台接口注入；断线通过真实 backend 重启触发。ASR 最终事件排空另有控制器回归，不宣称设备用例记录了全部上游 final 帧。
- 没有运行 Android、全仓 Web/Desktop 检查、全量 Go 或 Playwright。真实 Agent CLI 读取标签后回写、真人麦克风内容质量及历史 RecordPage 返回草稿问题继续保留待办。

复验：`python3 imind/app/tool/run_feature_e2e.py --platform ios --device 909E49E1-83F4-4A69-91C0-0F8D43EE88E0 --suite interaction`。图片用例输出 `E2E_INTERACTION_NATIVE_VIEWER` 后需在原生 UI 工具中检查并关闭 Done；最后一例会重启本地验收 backend。凭据与合成 PCM 仅通过私有临时 defines 传入，日志不输出凭据。用例清理本轮创建的笔记；中断留下的专用验收文件另按本轮时间与标题前缀清理。

### 收尾记录

普通本地入口 `flutter build ios --simulator --debug --dart-define=API_BASE=http://127.0.0.1:18607` 构建、安装成功。产物扫描确认不含本次编译期测试 token。原生启动 PID 84117，停止后重启 PID 84607；人工查看截图确认「菜单 / iMind / 录音 / 剪藏 / 笔记」首页控件和真实列表，已恢复安全存储的会话。证据：[普通包结果](../outputs/imind/ios-interaction-normal-results.json)、[重启首页](../outputs/imind/ios-interaction-normal-restart.png)、[构建日志](../outputs/imind/interaction-ios-normal-build.log)。首次启动早期的白屏截图未作为通过证据，等待首页实际显示后重新留存。

本轮集成用例的笔记均已通过 API 删除；另清理了一条中断留下的同前缀、同时间段专用笔记，未删除其他历史验收或用户文件。结果：[清理记录](../outputs/imind/interaction-fixture-cleanup.json)。本地 backend 与只提供文件共享的 daemon 保持可用。

### 安装与提交前整合（2026-10-30）

整合远端 `725f0f007`（群聊未读与通知）后，完整 `flutter test --concurrency=1` **150 项通过**，普通 iOS 模拟器 Debug 包重新构建并安装成功，PID 89683；产物再次扫描确认无编译期测试 token。恢复本地 `imindhost` 文件共享后，实际截图可见已登录首页与文件列表；新增通知权限弹窗留给用户选择。此次没有重跑上述 7 项 E2E，也不将已有交互验收扩大为通知功能 E2E 通过。日志为 `outputs/imind/interaction-integrated-flutter-tests.log` 和 `interaction-integrated-ios-build.log`。

## 首轮补充：编辑态退出确认

用户确认前五项实现选择，并要求编辑态返回先确认，放弃完整退出。笔记详情与录音详情已同步更新；iOS 编辑态识别 24px 起始边缘区域中至少 80px 的向右拖动来显示确认，阅读态保留原生系统手势。取消不改变草稿，确认放弃及顶部放弃停止语音后退出，不再回到阅读态。

- `flutter analyze`：无问题。
- `flutter test test/widget_test.dart --concurrency=1`（清除代理）：22 项通过。组件测试实际拖动边缘，覆盖两种详情取消保留草稿、确认放弃返回上一页和顶部放弃直接退出，以及系统返回确认。
- `git diff --check`：通过。
- 此次 Dart 交互调整未重新执行完整套件、设备构建或 E2E；下方完整套件与构建结果属于此前首轮实现。原生设备手势效果仍待验证。

## 首轮已执行

- `flutter analyze`：无问题。
- 清除 HTTP(S)/ALL_PROXY，设置 `NO_PROXY=localhost,127.0.0.1,::1`，执行 `flutter test --concurrency=1`：完整 142 项通过。包含首页 OR 多选、空首页下拉请求等待、长按标记、新建默认编辑、菜单编辑以及图片字节原生通道回归。
- 仓库根 `make env-exec ARGS='-- go -C server test ./internal/imind ./internal/handler -run TestIMind -count=1'`：通过，使用 checkout 受管理环境。新增 AI 标记持久化、revision 冲突、无效模型输出，以及原标签保留/去重和真实已有 hashtag 提示词断言通过。上游响应为测试替身。
- `flutter build ios --simulator --debug`：通过。
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home flutter build apk --debug`：通过。有现有 Gradle/Kotlin 支持周期及 SDK XML 版本警告，未修改依赖版本。
- `git diff --check`：通过。

单独直接运行 Go 测试时曾因默认测试环境的 DeepSeek 设置保存返回 500 而失败；改用仓库 `make env-exec` 的受管理 checkout 环境后全部定向回归通过，未更改其他数据库。

## 首轮尚未验证（后续 iOS 结果以上文为准）

- 按用户要求，所有本轮 E2E 均未执行。历史设备通过记录不作为本轮通过证据。
- iOS 27 / Android 的真实侧滑返回、图片点击与系统查看器交互、麦克风实时输入及权限/断线行为。
- 图片组件测试验证的是授权字节传给原生通道，使用直接调用手势回调；不代表设备实际触摸或原生查看器运行通过。
- 真实 DeepSeek 多标签效果及 Agent 依据已有 hashtag 回写文件。
- 未运行全仓前端检查或完整 Go 测试；本轮未修改 Web/Desktop UI。
- 审查发现的旧 RecordPage 系统返回及仅标题草稿保护问题另列 HANDOFF 待办，本轮未扩展该流程。
