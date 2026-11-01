# iMind 文章划词评论验收

2026-11-01。当前为待用户二次决策的实现，未发布。

## 行为

- 笔记、剪藏和录音正文预览使用系统长按选区，支持跨段选取。选区菜单提供「复制」和「AI+」。复制将选中文字转换成带格式的 Markdown，保留标题、强调、链接、代码、引用、列表和表格的语义；不承诺字节级保留原 Markdown 的等价写法。
- 「AI+」打开自动聚焦的划词评论输入框，与群聊共用 `AiComposer`。点击外层或关闭按钮取消；提交只暂存引用及指令，不发送群聊消息。
- 每条评论获得当前详情内单调递增的编号。正文持续高亮，并在选区末尾绘制编号；群聊输入框顶部展示待发送引用的编号胶囊，可删除。删除同步取消对应高亮，不重排剩余编号。
- 群聊发送时，以 `【“引用 Markdown”+用户指令：“逐条指令”】` 和 `---------` 分隔，再追加群聊输入；只发送一条消息。失败沿用可重试消息及原始 client ID，不重复消费新的引用。
- 暂存内容仅保留在当前详情生命周期内；关闭群聊再打开仍保留。发送后待发胶囊清空，正文标识保留到退出详情；正文改变时清除失效锚点。没有改动笔记文件格式或引入后端持久化。

## 验证与证据

- 单元测试：Markdown 局部格式恢复、重复文本与跨段偏移、列表/表格、消息拼接、删除与已发送标识、正文变更清理。
- 组件路径：长按真实渲染文本，复制检查剪贴板；外层取消不入队；连续三次划词评论；打开群聊删除第 3 个胶囊；最终发送包含前两条引用与群聊指令。
- iOS 27 模拟器运行 `integration_test/quote_e2e_test.dart`，使用同一路径和系统软键盘，截图由 `xcrun simctl io screenshot` 抓取。群聊 API 是内存测试替身，断言暂存阶段零次发送、最终发送一次且文案正确；不连接真实后端，不运行真实 Agent，也不代表 Android 或真实 Agent 回复已验收。
- 截图与执行日志位于 `outputs/imind/quotes/`：`01-selection-menu.png`、`02-selection-composer.png`、`03-highlighted-quotes.png`、`04-chat-queued-quotes.png`、`05-chat-sent-message.png`、`e2e.log`。

## 执行结果

- `flutter analyze`：通过，无问题。
- `flutter test --concurrency=1`：完整 211 项通过。
- 后补 `flutter test test/quote_flow_test.dart`：3 项通过，包含跨段实际选区复制与失败重试快照。
- iOS 模拟器 `flutter test integration_test/quote_e2e_test.dart -d BC7AFBB4-39A4-4444-9070-4DB6BC73DA23`：1 项通过，含外层取消、三条引用暂存、删除第 3 条、最终单次发送断言，5 张截图已逐项抓取。
- `git diff --check`：通过。未运行 Android 真机验证及真实后端/Agent 链路。

## 真机安装与提交验证

- 普通 iOS Release 包构建、签名成功，覆盖安装到已连接的 iPhone（iOS 26.3），bundle ID `ai.multica.imindApp`，启动成功。沿用默认 HTTPS 服务，没有 E2E 入口、测试会话或 API_BASE 编译参数。
- 将暂存区中的 App 文件导出到独立目录，`flutter analyze` 无问题，Markdown/选区/群聊/详情相关 41 项测试通过，验证本次提交不依赖其他未提交的 UI 或分发改动。
- 签名、安装与启动日志位于 `outputs/imind/quotes/ios-device-*.log/json`；暂存区验证日志为 `outputs/imind/quotes/staged-verification.log`。真机确认范围为安装和启动，未执行真机完整功能 E2E。
