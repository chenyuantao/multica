package ai.multica.imind_app

import android.content.Intent
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    private val chatChannel = "imind_chats"
    private val badgeNotification = 10

    override fun configureFlutterEngine(engine: FlutterEngine) {
        super.configureFlutterEngine(engine)
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(chatChannel, "AI+ 群聊", NotificationManager.IMPORTANCE_DEFAULT).apply {
                setShowBadge(true)
            })
        }
        MethodChannel(engine.dartExecutor.binaryMessenger, "imind/chat_notifications").setMethodCallHandler { call, result ->
            val notifications = NotificationManagerCompat.from(this)
            when (call.method) {
                "requestPermission" -> {
                    if (Build.VERSION.SDK_INT >= 33 && ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 102)
                    }
                    result.success(null)
                }
                "setBadge" -> {
                    val count = (call.argument<Int>("count") ?: 0).coerceAtLeast(0)
                    if (count == 0) {
                        notifications.cancel(badgeNotification)
                    } else if (canNotify()) {
                        notifications.notify(badgeNotification, NotificationCompat.Builder(this, chatChannel)
                            .setSmallIcon(R.mipmap.ic_launcher)
                            .setContentTitle("AI+ 群聊")
                            .setContentText("$count 条未读消息")
                            .setNumber(count)
                            .setOnlyAlertOnce(true)
                            .setSilent(true)
                            .setContentIntent(openAppIntent())
                            .build())
                    }
                    result.success(null)
                }
                "notify" -> {
                    val issueID = call.argument<String>("issueId") ?: ""
                    if (canNotify()) {
                        notifications.notify(issueID, 11, NotificationCompat.Builder(this, chatChannel)
                            .setSmallIcon(R.mipmap.ic_launcher)
                            .setContentTitle("AI+ 群聊有新消息")
                            .setContentText(call.argument<String>("title") ?: "iMind")
                            .setNumber((call.argument<Int>("total") ?: 0).coerceAtLeast(0))
                            .setAutoCancel(true)
                            .setContentIntent(openAppIntent())
                            .build())
                    }
                    result.success(null)
                }
                "clearChat" -> {
                    notifications.cancel(call.argument<String>("issueId") ?: "", 11)
                    result.success(null)
                }
                "clearAll" -> {
                    notifications.cancelAll()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
        // Read-only native evidence for integration tests; unavailable in Release.
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            MethodChannel(engine.dartExecutor.binaryMessenger, "imind/notification_inspection").setMethodCallHandler { call, result ->
                if (call.method != "state") { result.notImplemented(); return@setMethodCallHandler }
                val active = manager.activeNotifications
                result.success(mapOf(
                    "authorized" to canNotify(),
                    "badge" to (active.firstOrNull { it.id == badgeNotification }?.notification?.number ?: 0),
                    "delivered" to active.filter { it.id == 11 }.map { "imind-chat-${it.tag}" }
                ))
            }
        }
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

    private fun canNotify(): Boolean = Build.VERSION.SDK_INT < 33 ||
        ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}
