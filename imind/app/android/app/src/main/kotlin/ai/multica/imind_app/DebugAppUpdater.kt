package ai.multica.imind_app

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Debug-distribution APK updates; registered only for debuggable applications. */
class DebugAppUpdater(private val activity: FlutterActivity, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "imind/debug_update")
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val cancelled = AtomicBoolean(false)
    private val downloading = AtomicBoolean(false)
    @Volatile private var connection: HttpURLConnection? = null
    private var ready: File? = null
    private var readyVersion: Long? = null

    init {
        channel.setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "versionCode" -> result.success(version(installed()))
                    "cancel" -> {
                        cancelled.set(true)
                        connection?.disconnect()
                        result.success(null)
                    }
                    "download" -> {
                        val url = call.argument<String>("url") ?: error("Missing URL")
                        val hash = call.argument<String>("sha256") ?: error("Missing checksum")
                        val size = call.argument<Number>("size")?.toLong() ?: error("Missing size")
                        val code = call.argument<Number>("versionCode")?.toLong() ?: error("Missing version")
                        val uri = Uri.parse(url)
                        require(uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 &&
                            uri.userInfo == null && uri.query == null && uri.fragment == null &&
                            Regex("^/[^/]+/[^/]+/releases/download/imind-debug-$code/imind-debug\\.apk$").matches(uri.path ?: ""))
                        require(Regex("^[a-f0-9]{64}$").matches(hash))
                        require(size in 1..(512L * 1024 * 1024) && code > version(installed()))
                        check(downloading.compareAndSet(false, true)) { "Download already active" }
                        cancelled.set(false)
                        ready = null
                        readyVersion = null
                        executor.execute {
                            try {
                                val file = download(url, hash, size, code)
                                main.post {
                                    ready = file
                                    readyVersion = code
                                    downloading.set(false)
                                    result.success(null)
                                }
                            } catch (e: Exception) {
                                main.post {
                                    downloading.set(false)
                                    result.error("download_failed", "Unable to download or verify update", null)
                                }
                            }
                        }
                    }
                    "install" -> {
                        val file = ready ?: error("No verified update")
                        check(file.isFile && !downloading.get())
                        verifyArchive(file, readyVersion ?: error("No verified version"))
                        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
                            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:${activity.packageName}")))
                            result.success("permission_required")
                        } else {
                            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
                            activity.startActivity(Intent(Intent.ACTION_VIEW)
                                .setDataAndType(uri, "application/vnd.android.package-archive")
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                            result.success("installer_opened")
                        }
                    }
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("update_failed", "Unable to prepare update", null)
            }
        }
    }

    private fun download(source: String, expectedHash: String, expectedSize: Long, code: Long): File {
        val directory = File(activity.cacheDir, "app_updates").apply { mkdirs() }
        val partial = File(directory, "update.apk.part")
        val target = File(directory, "update.apk")
        try {
            target.delete()
            var url = URL(source)
            var response: HttpURLConnection? = null
            for (redirect in 0..5) {
                check(!cancelled.get())
                require(url.protocol == "https" && url.userInfo == null && url.port == -1 &&
                    url.host in setOf("github.com", "release-assets.githubusercontent.com",
                        "objects.githubusercontent.com", "github-releases.githubusercontent.com"))
                val current = (url.openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 15000
                    readTimeout = 15000
                    setRequestProperty("Accept-Encoding", "identity")
                }
                connection = current
                if (current.responseCode in listOf(301, 302, 303, 307, 308)) {
                    val location = current.getHeaderField("Location") ?: error("Missing redirect")
                    current.disconnect()
                    url = URL(url, location)
                } else {
                    check(current.responseCode == 200) { "Download failed" }
                    response = current
                    break
                }
            }
            val stream = response ?: error("Too many redirects")
            val digest = MessageDigest.getInstance("SHA-256")
            var count = 0L
            val started = System.nanoTime()
            stream.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        check(!cancelled.get())
                        check(System.nanoTime() - started < 10L * 60 * 1_000_000_000) { "Download timed out" }
                        val read = input.read(buffer)
                        if (read == -1) break
                        count += read
                        check(count <= expectedSize) { "Update too large" }
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                    }
                }
            }
            val hash = digest.digest().joinToString("") { "%02x".format(it) }
            check(!cancelled.get() && count == expectedSize && hash == expectedHash) { "Checksum mismatch" }
            verifyArchive(partial, code)
            check(partial.renameTo(target)) { "Unable to save update" }
            return target
        } finally {
            connection?.disconnect()
            connection = null
            partial.delete()
        }
    }

    @Suppress("DEPRECATION")
    private fun installed(): PackageInfo = activity.packageManager.getPackageInfo(activity.packageName, signatureFlags())

    @Suppress("DEPRECATION")
    private fun signatureFlags(): Int = if (Build.VERSION.SDK_INT >= 28)
        PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun version(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28)
        info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Set<String> {
        val signers = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signers?.map { signer ->
            MessageDigest.getInstance("SHA-256").digest(signer.toByteArray()).joinToString("") { "%02x".format(it) }
        }?.toSet() ?: emptySet()
    }

    private fun verifyArchive(file: File, code: Long) {
        val archive = activity.packageManager.getPackageArchiveInfo(file.absolutePath, signatureFlags())
            ?: error("Invalid APK")
        val current = installed()
        check(archive.packageName == activity.packageName && version(archive) == code && code > version(current))
        val currentSigners = signatures(current)
        check(currentSigners.isNotEmpty() && signatures(archive) == currentSigners) { "Signing key mismatch" }
    }

    fun close() {
        cancelled.set(true)
        connection?.disconnect()
        channel.setMethodCallHandler(null)
        executor.shutdownNow()
    }
}
