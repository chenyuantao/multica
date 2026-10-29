# 下一轮功能优化验收

2026-10-29。本轮五项实现完成，所有设备验证使用本地 Docker API（18607）、当前 checkout 的受管理 PostgreSQL 和本地新版 file-share daemon。未连接生产环境。最终设备验收严格按 iOS 27 → Android 15 的顺序执行；详细结果以以下日志和 JSON 为准。

## 实现与验证范围

| 功能 | 实现与回归 |
| --- | --- |
| 底部安全区 | 笔记、录音/边录边记、AI+、剪藏使用键盘和持久安全区较大值；全屏编辑关闭重复 Scaffold 缩放。helper 覆盖键盘开/关，设备检查聊天输入实际位置。 |
| 消息内查看/终止 | 对应 Agent 回复或占位气泡提供操作；独立执行详情、自己的返回；真实 task/messages 读取与取消 API。受控离线运行验证只取消所选文件运行。 |
| 录音自动标题摘要 | 全部文件/媒体落盘后立即调用服务端 DeepSeek；摘要存 YAML，文件名仍是标题来源；未配置显示已保存和命名重试，可保留原标题。录音详情可手动改名。 |
| AI 重命名 | 同一个服务端命名接口读取已保存 md，revision 保护和重名契约；失败原文件不变。后台按工作区配置加密 Key，客户端只发笔记 ID/revision。 |
| 剪藏 | 原始粘贴文本、提取链接和可选提示词保存于占位文件；同 UUID 的既有文件群聊发送一次初始化消息。后台可配置专用 Agent，未配置走 JEV。受控执行器从本地文章抓取、用 revision 回写并重命名原文件、在同群回复，保留元数据和其他文件。 |

另修复首页批量重命名/标签可能把列表缺省的正文、转写或音频写空的问题：读取完整文档后更新，仍使用所选 revision 防覆盖。

## 设备结果

iOS：iPhone 18 Pro，iOS 27.0，`909E49E1-83F4-4A69-91C0-0F8D43EE88E0`。Android：新建专用 `imind_optimization_api35`（Pixel 6 / Android 15 / API 35 / arm64，软件 GPU），`emulator-5554`。旧 `imind_e2e_api35` 的 ADB shell 在在线状态下超时，原数据完整保留，新设备完成全部最终验收。

| 用例 | iOS | Android |
| --- | --- | --- |
| 剪藏原文/提示词、同文件群聊、无 Agent 重试、安全区、真实 DeepSeek 标题摘要与手改名（2 项） | [通过](../outputs/imind/ios-optimization-p1-results.json) | [通过](../outputs/imind/android-optimization-p1-results.json) |
| 消息内查看、真实执行过程、独立返回、取消对应运行且另一文件保持 queued（1 项） | [通过](../outputs/imind/ios-progress-p1-results.json) | [通过](../outputs/imind/android-progress-p1-results.json) |
| 原生麦克风、真实 ASR ready、暂停续录、失败上传后原字节重试、WAV 保存/回放、真实自动标题摘要（1 项） | [通过](../outputs/imind/ios-main-p1-results.json) | [通过](../outputs/imind/android-main-p1-results.json) |
| 实际 UI AI 重命名、正文/标签保留、编辑/筛选/批量操作、revision 冲突、会话恢复（3 项） | [通过](../outputs/imind/ios-features-p1-results.json) | [通过](../outputs/imind/android-features-p1-results.json) |
| 普通本地 Debug 安装包与不同 PID 重启后已登录首页 | [通过](../outputs/imind/ios-optimization-normal-results.json) | [通过](../outputs/imind/android-optimization-normal-results.json) |

每端 7 项设备集成测试通过。命名相关最终结果均带 `naming_configured: true`，实际调用服务端 DeepSeek；未配置/失败恢复另有初轮设备观察及服务端自动化回归。输入框实测 iOS 安全区 34 / 键盘 328，Android 安全区 24 / 键盘约 336.38；两种状态均断言输入框在对应区域之上。

截图已检查：[iOS 群聊与键盘](../outputs/imind/ios-optimization-p1-chat.png)、[Android 群聊与键盘](../outputs/imind/android-optimization-p1-chat.png)、[iOS 执行详情](../outputs/imind/ios-progress-p1-chat.png)、[Android 执行详情](../outputs/imind/android-progress-p1-chat.png)。普通包重启：iOS 7874 → 7967，Android 4973 → 5096；iOS 首页截图为 `ios-optimization-normal.png`，Android 为 `android-device-optimization-normal.png`。普通包已覆盖测试入口和编译期测试凭据。

初轮测试适配了聊天弹层动画、异步保存完成和通知遮挡的等待条件；同时更新旧“播放”按钮断言为既有“无原始录音”。最终以上四组最新结果全部通过，不把中途测试失败记为通过。

## 自动化检查

- Flutter 全量单测 134 项通过；`flutter analyze` 无问题。
- 当前 checkout 数据库上的 iMind handler/model 与迁移索引登记定向回归通过，见 `outputs/imind/optimization-go-tests.log`。覆盖加密配置、权限、命名成功与 malformed provider、空 Key、revision 冲突、剪藏受控抓取/原文件回写与隔离。
- Core API 140 项、翻译一致性 220 项、相关设置组件 ESLint 通过。Views typecheck 仍有三处既有错误：`im/chat-documents-section.test.tsx:88`、`im/doc-open-path.ts:3`、`im/reminder-page.test.tsx:410`；本轮未修改这些文件。
- 本地 Docker 最终镜像重建、589 迁移和新版 daemon 完成；14 项现有文件/授权契约实联调通过，见 `optimization-contract.log` 和 `contract-results.json`。
- `git diff --check`、两份 E2E Python runner 语法检查通过；变更文件中的模型 Key 模式扫描为零。
- 未运行全仓前端 lint/test、全量 Go 或 Playwright；设备 E2E 使用实际 Flutter 模拟器 integration_test。

## 验证边界

- 初轮设备验证覆盖无 Key 时保存保留、错误提示和手改名；用户随后授权使用所提供 Key，已通过本地管理接口加密配置，并补验真实 DeepSeek。最新设备结果中 `naming_configured: true` 要求真实生成成功，provider 失败会使测试失败。模型 Key 未写入客户端、日志或仓库。后台只返回 configured，工作区数据库模型的密文字段还禁止 JSON 序列化。
- 专用验收工作区平时没有智能体；执行详情测试临时创建离线 runtime/Agent 和排队运行，结束清理。剪藏成功回写和默认/JEV 分发使用受控执行器，不运行用户安装的真实 Agent CLI，不宣称真实网站内容抓取质量。
- 仍仅模拟器；真机拍照、实际听音、真人语音质量、长录音与中断恢复、正式签名分发保留原有边界。

## 本地复验

按 app/README 的 `--suite optimization|progress|main|features` 复验，先 iOS 再 Android。Key 已配置在本地 `imind-validation` 工作区，不复制到生产环境。部署加密密钥保存在私有本地 `~/.multica/profiles/imind-android/imind-secret-key`（0600），重建并启动 compose 前应以环境变量传入；它不是 DeepSeek 模型 Key。只用 `restart backend` 时已有容器环境保持不变。

最终镜像构建的磁盘不足已通过清理未使用构建缓存和本轮失败构建容器解决，未清理数据库或卷；最终日志为 `optimization-docker-final-build.log`。
