# iMind 剩余 E2E 补验

2026-10-31。范围为本地 Docker API、当前 checkout 的受管理 PostgreSQL、`imind-validation` 专用工作区；未部署或验证生产环境。

- iOS：新建的 `imind_e2e_notifications`，iPhone 18 Pro / iOS 27.0，`BC7AFBB4-39A4-4444-9070-4DB6BC73DA23`。
- Android：`imind_e2e_api35`，Android 15 / API 35，`emulator-5554`。
- 两端构建串行执行，共用 `device_test_lock`；测试凭据只经私有临时 defines 文件传入。消息接收、文件读写、未读、已读和重连均连接真实本地服务。

## 结果

| 验证 | iOS | Android |
| --- | --- | --- |
| 最新交互、搜索、四种排序、标签、图片与编辑语音 | 运行中 | 7 项通过；语音资源生命周期断言调整后待定向复验 |
| 两名用户、系统通知、角标、已读、共享根/工作区切换、前后台、重连和退出 | 复验中 | 初次全流程通过；历史未读重复通知修复后复验中 |
| 系统拒绝通知权限 | 待验证 | 待验证 |

最终结果以本页更新后的结果和对应结果 JSON 为准；`initial`、`before-*`、`*-early` 文件保留失败或过渡状态，不作为通过证据。

## 覆盖方式

交互套件使用真实文件 API，覆盖首页剪藏入口、普通/空筛选下拉刷新、标签 OR 筛选与保留类型的取消操作；依据真实创建/更新时间验证四种排序；标题/正文搜索忽略英文大小写，返回退出搜索并保留标签。

笔记、已完成剪藏和录音详情均验证阅读态点击不编辑、菜单编辑、返回确认取消保稿、确认放弃退出详情，以及顶部放弃恢复已保存内容并留在阅读态。剪藏夹具先创建空占位文件，再通过更新接口写入完成正文，符合当前服务端契约。

手动标记覆盖已有与新建标签；详情和首页 AI 标记调用真实 DeepSeek，检查原标签、正文及标题保留、revision 更新和旧 revision 不覆盖并发修改。模型可合法复用已有标签，因此以成功写入和保留原标签验收，不要求每次生成新标签。

图片经真实上传、授权读取和触摸打开。Android 使用 Google Photos 的系统 `ACTION_VIEW`；iOS 使用 Quick Look，并实际关闭返回。语音分别验证原生麦克风启动/停止，以及按实时速率发送合成中文 PCM 至真实 ASR，检查光标选区替换、保留后文、保存排空、断线保稿和重试。编辑器权限拒绝通过采集接口注入；通知权限拒绝使用实际系统权限。

通知套件由第二名测试用户经真实评论接口发送消息，App 通过工作区 WebSocket 接收。对照服务端未读、首页 item、详情 AI+ 和原生状态，验证预加载不清未读、展开清零、活动聊天不通知、其他文件仍通知。原生检查通道读取系统已送达通知及角标，不替换通知实现；仅 Debug 可用，Release 不注册。

共享根隔离使用第二个临时目录和独立 file-share daemon；工作区隔离使用临时真实工作区。当前 App 没有共享根/工作区选择器，用例调用实际 `SessionController.select` 接口，并通过首页刷新检查另一共享根的文件。App 图标计数仍是当前工作区所有可访问 iMind 群聊总数。前后台验证在 Android 实际按 Home，在 iOS 切换到系统设置，由宿主在后台发消息，再恢复 App；重连验证实际重启本地 backend。退出后继续发消息，检查旧会话不再通知。

## 验收中修复

- iOS 注册 `UNUserNotificationCenter` 的前台通知代理，使前台消息使用既定的 banner、声音和角标策略。
- 共享 daemon 暂不可用时，未读接口可暂时不返回其群聊。控制器保留当前会话内的通知计数基线，恢复相同历史未读不再重复通知；恢复期间增加的未读仍通知。退出或切换账号/工作区清理该基线。新增控制器回归及设备重连断言。
- runner 支持 Android 最新交互套件、系统通知允许/拒绝两种运行及 `--plain-name` 定向复验；Android 权限在测试进程启动前配置。宿主操作失败时终止测试子进程并释放构建锁。
- 修正旧用例对剪藏夹具及顶部放弃的假设。顶部放弃停止语音但保留当前阅读页；离开详情时才要求录音对象销毁。

## 证据与复验

- 交互：[iOS 结果](../outputs/imind/ios-interaction-p1-results.json)、[iOS 日志](../outputs/imind/ios-interaction-p1.log)、[Android 结果](../outputs/imind/android-interaction-p1-results.json)、[Android 日志](../outputs/imind/android-interaction-p1.log)。
- 通知：[iOS 结果](../outputs/imind/ios-notifications-p1-results.json)、[iOS 日志](../outputs/imind/ios-notifications-p1.log)、[Android 结果](../outputs/imind/android-notifications-p1-results.json)、[Android 日志](../outputs/imind/android-notifications-p1.log)。
- Android 查看器：[已打开图片](../outputs/imind/android-interaction-p1-native-viewer.png)、[原生活动记录](../outputs/imind/android-interaction-p1-native-viewer.txt)。

```sh
python3 imind/app/tool/run_feature_e2e.py --platform ios \
  --device BC7AFBB4-39A4-4444-9070-4DB6BC73DA23 --suite interaction
python3 imind/app/tool/run_feature_e2e.py --platform ios \
  --device BC7AFBB4-39A4-4444-9070-4DB6BC73DA23 --suite notifications
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  python3 imind/app/tool/run_feature_e2e.py --platform android \
  --device emulator-5554 --suite interaction --mirror
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  python3 imind/app/tool/run_feature_e2e.py --platform android \
  --device emulator-5554 --suite notifications --mirror
```

拒绝通知运行追加 `--notifications-denied`。Android 需要先安装 App，runner 在启动前设置系统权限；iOS 先在系统设置关闭该 App 的通知，用例要求实际 `authorizationStatus=denied`。iOS 图片用例的 `E2E_INTERACTION_NATIVE_VIEWER` 标记后，需检查并关闭系统查看器；通知用例的 `E2E_NOTIFICATION_BACKGROUND` 标记后，runner 自动切换 Android 首页或 iOS 系统设置并恢复 App。当前原生工具的默认模拟点击未能关闭系统查看器，改用 AXe 的 `--tap-style physical`，按无障碍目标的点坐标触摸并检查关闭结果。

本地重建 backend 时须按 [README](app/README.md) 将既有私有 `imind-secret-key` 以环境变量传给 compose；数据库显示模型已配置不代表容器已取得解密密钥。此次已恢复既有本地密钥，没有复制模型 Key 到客户端。

## 边界与保留项

- 原生通知依赖 App 收到 WebSocket；Debug 模拟器的短时后台测试不证明系统挂起或终止后的可靠送达。没有实现远程推送。
- Android 原生结果核对通知的 `number`；Pixel Launcher 使用通知圆点，不能据此声称所有 Android launcher 显示数字角标。
- 真人讲话识别质量、真机拍照和实际听音仍沿用此前延期范围；合成 PCM 和模拟器麦克风不替代这些验收。
- 真实智能体 CLI 读取已有标签并回写尚待明确授权；仓库 `AGENTS.md` 要求明确授权后才能运行真实智能体 smoke。未以受控后端回归冒充真实 CLI 通过。
- RecordPage 的历史系统返回/仅标题草稿保护问题未在本轮扩展。
