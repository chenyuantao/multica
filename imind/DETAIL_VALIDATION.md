# iMind 详情页与键盘交互验收

2026-10-30，iPhone 18 Pro / iOS 27.0 模拟器，设备 `909E49E1-83F4-4A69-91C0-0F8D43EE88E0`。使用本地 Docker API、专用验收工作区和 file-share daemon。

## 实现

- 笔记、剪藏和音频详情统一使用更多菜单：文件信息、重命名、导出（保持不可用）、删除；正文点击进入编辑，无独立编辑按钮。
- 文件标题位于返回右侧，单行省略；更多左侧提供 AI+，打开当前文件的既有群聊。
- 阅读区不常驻字数、标签、链接、摘要和时间；Info 信息面板可滚动查看、选择和复制元数据值，嵌套音频/剪藏信息完整显示。
- 聊天输入框外点击明确收起键盘；输入框与语音按钮属于同一点击区域。语音期间使用输入过滤保护草稿，保持键盘连接；输入区域使用稳定 key，避免语音状态提示插入时重建并丢失焦点。

## 结果

| 验证 | 结果 |
| --- | --- |
| 新增详情页 iOS E2E | 3/3 通过：note、clip、recording |
| 现有 optimization iOS E2E | 2/2 通过：剪藏群聊/重试、安全区、真实命名、音频手动重命名 |
| Flutter 单测 | 135 项通过 |
| `flutter analyze` | 无问题 |
| Python runner 编译、`git diff --check` | 通过 |

详情用例通过实际 Flutter 页面和本地 API 验证：长标题属性/位置、统一菜单、元数据值、点击正文编辑与保存落盘、顶部 AI+ 打开文件群聊、iOS 原生键盘展开、点击输入框保持键盘、原生麦克风及 ASR 开始/停止时保持键盘、点击聊天标题/消息区/发送收起键盘。键盘断言读取实际 `viewInsets.bottom`。临时文件在测试结束删除，验收群聊可能保留。

最终证据：[详情结果](../outputs/imind/ios-detail-p1-results.json)、[详情日志](../outputs/imind/ios-detail-p1.log)、[优化回归结果](../outputs/imind/ios-optimization-p1-results.json)、[单测日志](../outputs/imind/detail-unit.log)。修复前键盘失败证据保留为 `outputs/imind/ios-detail-before-composer-fix.log`。

已检查截图：[笔记工具栏](../outputs/imind/ios-detail-p1-note-toolbar.png)、[文件信息](../outputs/imind/ios-detail-p1-note-info.png)、[剪藏键盘](../outputs/imind/ios-detail-p1-clip-keyboard.png)、[音频工具栏](../outputs/imind/ios-detail-p1-recording-toolbar.png)。各类型均有 toolbar/info/keyboard 三张截图。

复验命令见 [app/README.md](app/README.md#detail-toolbar-and-chat-keyboard-acceptance)。本轮功能 E2E 在 iOS 模拟器执行，未跑 Android、真机 E2E 或全仓 Web/Go 测试；没有修改后端。原生麦克风启动和真实 ASR 连接不代表真人听写准确率验收。

普通 Debug 包已重新构建、安装并启动（PID 11133），保留既有登录会话，覆盖测试入口及编译期测试凭据；[构建日志](../outputs/imind/ios-detail-normal-build.log)、[启动截图](../outputs/imind/ios-detail-normal.jpg)。

## 执行过程折叠补验

参考 Web `chat-message-list.tsx` 的工具调用/结果/思考折叠行，App 每条思考、工具调用、工具结果、回复和错误均默认折叠，保留一行摘要；点击整行展开完整内容，再次点击收起。按运行消息序号保存当前页面内的展开选择，轮询刷新不会重置，新增消息仍折叠。Markdown、可选择的工具参数/输出及截断提示保留。

新增组件回归覆盖五类消息、单条独立切换、刷新保留状态、新消息默认折叠。iOS `progress` E2E 通过真实 API 读取受控离线运行，验证五类消息默认折叠、分别展开/收起和刷新保留状态，再验证终止仅影响对应运行、独立返回聊天。没有执行真实 Agent CLI。

[执行过程结果](../outputs/imind/ios-progress-p1-results.json)、[默认折叠截图](../outputs/imind/ios-progress-p1-collapsed.png)、[展开截图](../outputs/imind/ios-progress-p1-expanded.png)。本轮合计 6 项 iOS E2E 通过、135 项 Flutter 单测通过，静态分析无问题。

## iPhone 安装

已为连接的 iPhone 17（iOS 26.3）构建并签名普通 Release 包，安装成功，bundle ID 为 `ai.multica.imindApp`。使用默认 HTTPS 预览服务，不包含本地 E2E 地址、测试入口或会话 defines。签名配置只通过构建参数传入，没有改写仓库中的团队配置。

[真机构建日志](../outputs/imind/ios-device-release-build.log)、[签名日志](../outputs/imind/ios-device-sign-build.log)、[安装结果](../outputs/imind/ios-device-install.json)。首次自动启动被设备锁屏拦截；安装成功与真机功能 E2E 分开记录。
