# iMind 会话、样式与离线缓存验收

日期：2026-11-02。实现由三个子代理分别负责会话/联系人/搜索、公共样式、缓存基础设施/会话详情；主代理负责笔记缓存、整合及设备 E2E。

## 实现范围

- 顶部列表与会话详情共用 `DetailTitle`（17px、w600）；侧栏共用标题组件。
- 页级返回、取消、保存、删除、发送、登录与重试统一图标按钮，视觉 44px、点击区域 48px，保留 tooltip/可访问名称。确认对话框保留明确文字选项，图标加文字的组合胶囊保持原结构。
- 联系人共用会话 actor 头像规则。已有直聊直接打开；新直聊使用 Multica 的幂等接口。
- 会话搜索在顶部栏展开，组合本地已缓存正文与现有 IM 网络搜索；排序沿用标题匹配、命中次数、最新活动规则，网络命中覆盖同会话的本地计数。
- 笔记/会话列表与详情使用加密持久缓存，隔离 API 服务、账号会话、工作区和共享根。缓存可先渲染；网络先成功则丢弃晚到缓存；过期请求不更新 UI。
- 网络数据确认前，主动写入使用统一 toast 拦截；保留草稿。失败的笔记详情保留离线内容并可重试同步。

## 自动检查

- `flutter analyze`：通过。
- `flutter test --concurrency=1`：261/261 通过，包含竞速、过期请求、隔离、缓存写入、联网前拦截和失败重试。日志：[完整回归](../outputs/imind/optimization-regression.log)。
- `git diff --check`：通过。
- 无 TypeScript、数据库协议或后端代码变更；未运行全仓前端、全量 Go 或 Playwright。

## 原生隔离用例

`integration_test/navigation_e2e_test.dart` 使用受控 API/存储；通知权限在独立通知套件验证，此处拦截通知 channel，避免系统弹窗干扰导航。两项测试分别覆盖三 tab/菜单/联系人新会话/发送/正文搜索/退出，以及列表详情缓存首屏、重命名/标记/删除/编辑/发送拦截和网络确认后解锁。

- Android 15 `imind_e2e_api35`：2/2 通过（Flutter 输出另计 teardown）。[日志](../outputs/imind/navigation-android-e2e.log)，[截图目录](../outputs/imind/navigation-android/)。
- iOS 27 `imind_e2e_notifications`：2/2 通过（Flutter 输出另计 teardown）。[日志](../outputs/imind/navigation-e2e.log)，[截图目录](../outputs/imind/navigation/)。

## 真实本地后端

`tool/run_feature_e2e.py --platform ios|android --device <id> --suite navigation` 使用私密临时 defines，要求专用 `imind-validation` 工作区、`imindhost` 共享和现有 `iMind device peer` 测试联系人，无可执行智能体。用原生联系人入口和输入框实际发送唯一测试消息，核对后端持久化、正文网络搜索、Secure Storage 重新读取及慢网缓存发送拦截；结束后删除测试消息并刷新缓存。

本地原容器未包含仓库已有的会话列表修复（读取笔记源的旧实现导致列表超时），验收前使用当前仓库重新构建本地后端；未修改后端源码。

- Android 15 真实本地 API：1/1 通过。[结果](../outputs/imind/android-navigation-p1-results.json)，[日志](../outputs/imind/android-navigation-p1.log)。

- iOS 27 真实本地 API：1/1 通过。[结果](../outputs/imind/ios-navigation-p1-results.json)，[日志](../outputs/imind/ios-navigation-p1.log)。
- 两端均等待返回动画结束并检查可点击目标，点击未命中直接失败；从应用自动写入的 Secure Storage 缓存读取测试消息，再用慢网重新打开。iOS 截图前前置运行中的测试场景，截图已人工核对为实际 App 界面。
- 测试消息已清理；专用测试联系人的直聊保留复用。

## 普通安装包恢复

- Android 普通 Debug APK 构建、覆盖安装与启动通过：[构建日志](../outputs/imind/optimization-android-normal-build.log)。
- iOS 普通 Simulator Debug 构建、覆盖安装与启动通过：[构建日志](../outputs/imind/optimization-ios-normal-build.log)。
- 两端恢复包均未传入测试 defines；检查编译资源中不存在导航测试入口与测试消息标记。

## 验收边界

本地搜索覆盖已下载的会话历史；其他历史由网络搜索补充。缓存覆盖接口数据、笔记正文与消息历史，本轮未增加图片/音频二进制离线下载。设备验收使用模拟器，无真实智能体 CLI 或生产服务发布。
