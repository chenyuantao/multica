# AI+ 流式语音输入验收

2026-10-29；本地 Docker backend、`imind-validation` 专用工作区及 `imindhost` 共享根。复用现有 `record` 采集、`AsrSession` 和服务端实时 ASR，无新 SDK 或后端接口。

## 交互

- 输入框旁麦克风开始语音输入，ready 后才采集 16 kHz 单声道 PCM。partial 直接更新输入框，同一句修订覆盖旧结果，final 固定该句；在启动时光标/选区插入并保留选区外文字。
- 识别和停止排空期间输入框只读、发送禁用，防止修订覆盖手动编辑或发送半句。停止先停麦克风再等待 final/done；之后可编辑并手动发送，不自动发送。
- 拒绝权限、断线、采集失败和最终结果超时保留现有文字并显示恢复提示，可再次开始。关闭弹层释放麦克风和 ASR 连接；晚到事件不能修改已销毁输入框。不持久化口述音频。

## 自动化

`flutter analyze` 无问题；完整 `flutter test --concurrency=1` 125 项通过（原 122 项加 3 项语音控制器回归）。新增回归验证选区/草稿保留、partial 替换、final 去重、PCM 参数与传输、停止等待尾部结果、再次口述、权限拒绝、断线保留和销毁后的事件。日志：`outputs/imind/voice-analyze.log`、`voice-flutter-test.log`、`voice-unit.log`。

## 设备 E2E

`integration_test/voice_e2e_test.dart` 在真实 Flutter 模拟器 App 中依次验证：

1. 实际原生麦克风权限/启动，进入聆听状态，停止并恢复输入状态。
2. 注入按实时速率送出的合成中文 PCM，经真实 Docker、WebSocket 和真实 ASR 模型返回；断言 partial 在点击停止之前已经填入输入框，期间发送禁用、输入框只读。
3. 停止后断言 final 返回，原有“已有草稿：”保留、输入框恢复编辑；通过发送按钮把最终文字提交到真实文件群聊，并清空输入框。

| 平台 | 结果 | 证据 |
| --- | --- | --- |
| iOS 27.0 / iPhone 18 Pro 模拟器 | 通过 | `outputs/imind/ios-voice-p1-results.json`、`ios-voice-p1.log` |
| Android 15 / imind_e2e_api35 | 通过 | `outputs/imind/android-voice-p1-results.json`、`android-voice-p1.log` |

双端的 `*-voice-p1-chat.png` 截图均在停止前的聆听状态留存并人工查看，展示输入框中的已识别文字和禁用的发送按钮。

合成语音用于可重复的识别内容验证，原生麦克风采集独立验证；不声称真人语音质量或真机覆盖。专用工作区无智能体，消息显示“Agent 暂不可用”是预期状态，未执行真实 Agent CLI。

复验：`python3 imind/app/tool/run_feature_e2e.py --platform ios|android --device <device> --suite voice`；Android 可加 `--mirror`。设备构建串行，凭据和 PCM 仅在临时 defines 中，日志不输出凭据。

普通入口构建也已通过：`voice-ios-normal-build.log`、`voice-android-normal-build.log`；产物为 `app/build/ios/iphonesimulator/Runner.app` 与 `app/build/app/outputs/flutter-apk/app-debug.apk`。`git diff --check` 与测试入口 Python 语法检查通过。本次未修改后端，未重跑 Go 或 Web 全仓检查。
