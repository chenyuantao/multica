import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

const _manifestUrl = String.fromEnvironment('IMIND_UPDATE_MANIFEST_URL');

class DebugUpdate {
  const DebugUpdate({
    required this.versionCode,
    required this.versionName,
    required this.apkUrl,
    required this.sha256,
    required this.size,
  });

  final int versionCode;
  final String versionName;
  final Uri apkUrl;
  final String sha256;
  final int size;

  factory DebugUpdate.parse(Object? value, Uri manifest) {
    if (value is! Map<String, dynamic> ||
        value['application_id'] != 'ai.multica.imind_app' ||
        value['channel'] != 'imind-debug') {
      throw const FormatException('Invalid update channel');
    }
    final code = value['version_code'];
    final name = value['version_name'];
    final hash = value['sha256'];
    final size = value['size'];
    final url = value['apk_url'];
    final apk = url is String ? Uri.tryParse(url) : null;
    final repo = manifest.pathSegments.take(2).join('/');
    if (code is! int ||
        code < 1 ||
        code > 2100000000 ||
        name is! String ||
        name.isEmpty ||
        name.length > 80 ||
        hash is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(hash) ||
        size is! int ||
        size < 1 ||
        size > 512 * 1024 * 1024 ||
        apk == null ||
        apk.scheme != 'https' ||
        apk.host != 'github.com' ||
        apk.userInfo.isNotEmpty ||
        apk.hasPort ||
        apk.hasQuery ||
        apk.hasFragment ||
        apk.path !=
            '/$repo/releases/download/imind-debug-$code/imind-debug.apk') {
      throw const FormatException('Invalid update manifest');
    }
    return DebugUpdate(
      versionCode: code,
      versionName: name,
      apkUrl: apk,
      sha256: hash,
      size: size,
    );
  }
}

class DebugUpdateService {
  DebugUpdateService({
    required this.manifest,
    http.Client? client,
    this.channel = const MethodChannel('imind/debug_update'),
  }) : _client = client ?? http.Client();

  final Uri manifest;
  final http.Client _client;
  final MethodChannel channel;

  Future<DebugUpdate?> check() async {
    if (manifest.scheme != 'https' ||
        manifest.host != 'github.com' ||
        manifest.userInfo.isNotEmpty ||
        manifest.hasPort ||
        manifest.hasQuery ||
        manifest.hasFragment ||
        manifest.pathSegments.length != 6 ||
        manifest.pathSegments.skip(2).join('/') !=
            'releases/download/imind-debug/version.json') {
      throw const FormatException('Invalid update source');
    }
    final installed = await channel.invokeMethod<int>('versionCode');
    if (installed == null) return null;
    final response = await _client
        .get(manifest, headers: {'Cache-Control': 'no-cache'})
        .timeout(const Duration(seconds: 15));
    if (response.statusCode == 404) return null;
    if (response.statusCode != 200 || response.bodyBytes.length > 16384) {
      throw const FormatException('Update check failed');
    }
    final update = DebugUpdate.parse(jsonDecode(response.body), manifest);
    return update.versionCode > installed ? update : null;
  }

  Future<void> download(DebugUpdate update) =>
      channel.invokeMethod<void>('download', {
        'url': update.apkUrl.toString(),
        'sha256': update.sha256,
        'size': update.size,
        'versionCode': update.versionCode,
      });

  Future<void> cancel() => channel.invokeMethod<void>('cancel');

  Future<String?> install() => channel.invokeMethod<String>('install');

  void close() => _client.close();
}

/// Enabled only in explicitly configured Android debug distribution builds.
class DebugUpdateGate extends StatefulWidget {
  const DebugUpdateGate({super.key, required this.child, this.service});
  final Widget child;
  final DebugUpdateService? service;

  @override
  State<DebugUpdateGate> createState() => _DebugUpdateGateState();
}

class _DebugUpdateGateState extends State<DebugUpdateGate>
    with WidgetsBindingObserver {
  DebugUpdateService? _service;
  bool _checking = false;
  bool _dialogOpen = false;
  int? _promptedVersion;
  DateTime? _lastCheck;

  @override
  void initState() {
    super.initState();
    if (widget.service != null) {
      _service = widget.service;
    } else if (kDebugMode &&
        !kIsWeb &&
        defaultTargetPlatform == TargetPlatform.android &&
        _manifestUrl.isNotEmpty) {
      _service = DebugUpdateService(manifest: Uri.parse(_manifestUrl));
    }
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_check());
  }

  Future<void> _check() async {
    final service = _service;
    if (!mounted ||
        service == null ||
        _checking ||
        _dialogOpen ||
        (_lastCheck != null &&
            DateTime.now().difference(_lastCheck!) <
                const Duration(minutes: 5))) {
      return;
    }
    _checking = true;
    _lastCheck = DateTime.now();
    try {
      final update = await service.check();
      if (!mounted ||
          update == null ||
          update.versionCode == _promptedVersion) {
        return;
      }
      _promptedVersion = update.versionCode;
      _dialogOpen = true;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (_) => _DebugUpdateDialog(update: update, service: service),
      );
    } catch (_) {
      // An unavailable update source must not interrupt login or note editing.
    } finally {
      _checking = false;
      _dialogOpen = false;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (widget.service == null) _service?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _DebugUpdateDialog extends StatefulWidget {
  const _DebugUpdateDialog({required this.update, required this.service});
  final DebugUpdate update;
  final DebugUpdateService service;

  @override
  State<_DebugUpdateDialog> createState() => _DebugUpdateDialogState();
}

class _DebugUpdateDialogState extends State<_DebugUpdateDialog> {
  bool _busy = false;
  bool _downloaded = false;
  bool _cancelled = false;
  String? _message;

  Future<void> _update() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      if (!_downloaded) {
        await widget.service.download(widget.update);
        _downloaded = true;
      }
      if (!mounted || _cancelled) return;
      final result = await widget.service.install();
      if (mounted) {
        setState(() {
          _message = result == 'permission_required'
              ? '请允许 iMind 安装应用，返回后点“继续安装”。'
              : '请在系统界面确认安装；取消后可重试。';
        });
      }
    } catch (_) {
      if (mounted && !_cancelled) {
        setState(() {
          _message = _downloaded ? '无法打开安装界面，请重试。' : '下载或校验失败，请重试。';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _dismiss() async {
    _cancelled = true;
    try {
      await widget.service.cancel();
    } catch (_) {
      /* The dialog can still close. */
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: AlertDialog(
      title: Text('发现新版本 ${widget.update.versionName}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_busy) ...[
            const LinearProgressIndicator(),
            const SizedBox(height: 12),
            const Text('正在下载并校验更新...'),
          ] else
            Text(
              _message ??
                  '下载约 ${(widget.update.size / 1024 / 1024).ceil()} MB，安装后保留现有数据。',
            ),
        ],
      ),
      actions: [
        TextButton(onPressed: _dismiss, child: Text(_busy ? '取消下载' : '稍后')),
        TextButton(
          onPressed: _busy ? null : _update,
          child: Text(_downloaded ? '继续安装' : '下载更新'),
        ),
      ],
    ),
  );
}
