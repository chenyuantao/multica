package ai.multica.imind_app

import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(engine: FlutterEngine) {
        super.configureFlutterEngine(engine)
        MethodChannel(engine.dartExecutor.binaryMessenger, "imind/image_viewer").setMethodCallHandler { call, result ->
            if (call.method != "open") { result.notImplemented(); return@setMethodCallHandler }
            try {
                val bytes = call.argument<ByteArray>("bytes") ?: throw IllegalArgumentException("Missing image")
                val extension = call.argument<String>("extension") ?: "jpg"
                require(extension in listOf("jpg", "jpeg", "png", "webp"))
                val directory = File(cacheDir, "image_viewer").apply { mkdirs() }
                val file = File(directory, "image.$extension").apply { writeBytes(bytes) }
                val uri = FileProvider.getUriForFile(this, "$packageName.imageviewer", file)
                val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, if (extension == "jpg") "image/jpeg" else "image/$extension")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                startActivity(intent)
                result.success(null)
            } catch (e: Exception) { result.error("open_failed", e.message, null) }
        }
    }
}
