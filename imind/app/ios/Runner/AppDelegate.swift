import Flutter
import UIKit
import QuickLook
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate, QLPreviewControllerDataSource {
  private var imageURL: URL?

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { imageURL! as NSURL }
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound, .badge])
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let notifications = FlutterMethodChannel(name: "imind/chat_notifications", binaryMessenger: engineBridge.applicationRegistrar.messenger())
    notifications.setMethodCallHandler { call, result in
      let center = UNUserNotificationCenter.current()
      let args = call.arguments as? [String: Any] ?? [:]
      switch call.method {
      case "requestPermission":
        center.requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in
          DispatchQueue.main.async { result(nil) }
        }
      case "setBadge":
        let count = max(0, args["count"] as? Int ?? 0)
        DispatchQueue.main.async {
          UIApplication.shared.applicationIconBadgeNumber = count
          result(nil)
        }
      case "notify":
        let issueID = args["issueId"] as? String ?? ""
        let content = UNMutableNotificationContent()
        content.title = "AI+ 群聊有新消息"
        content.body = args["title"] as? String ?? "iMind"
        content.sound = .default
        content.badge = NSNumber(value: max(0, args["total"] as? Int ?? 0))
        center.add(UNNotificationRequest(identifier: "imind-chat-\(issueID)", content: content, trigger: nil)) { _ in
          DispatchQueue.main.async { result(nil) }
        }
      case "clearChat":
        let issueID = args["issueId"] as? String ?? ""
        center.removeDeliveredNotifications(withIdentifiers: ["imind-chat-\(issueID)"])
        center.removePendingNotificationRequests(withIdentifiers: ["imind-chat-\(issueID)"])
        result(nil)
      case "clearAll":
        center.removeAllDeliveredNotifications()
        center.removeAllPendingNotificationRequests()
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    let channel = FlutterMethodChannel(name: "imind/image_viewer", binaryMessenger: engineBridge.applicationRegistrar.messenger())
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "open", let args = call.arguments as? [String: Any],
            let bytes = args["bytes"] as? FlutterStandardTypedData,
            let ext = args["extension"] as? String, ["jpg", "jpeg", "png", "webp"].contains(ext),
            let self = self else { result(FlutterError(code: "invalid", message: "Invalid image", details: nil)); return }
      do {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("imind-image.\(ext)")
        try bytes.data.write(to: url, options: .atomic)
        self.imageURL = url
        let preview = QLPreviewController()
        preview.dataSource = self
        guard let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first else {
          result(FlutterError(code: "open_failed", message: "No window", details: nil)); return
        }
        var presenter = root
        while let presented = presenter.presentedViewController { presenter = presented }
        presenter.present(preview, animated: true)
        result(nil)
      } catch { result(FlutterError(code: "open_failed", message: error.localizedDescription, details: nil)) }
    }
  }
}
