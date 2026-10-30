import Flutter
import UIKit
import QuickLook

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

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
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
