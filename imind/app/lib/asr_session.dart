import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'api.dart';

/// Keeps authentication in upgrade headers and drains final results before save.
class AsrSession {
  AsrSession({
    required this.channel,
    required this.onMessage,
    this.timeout = const Duration(seconds: 18),
  });

  static AsrSession connect({
    required MulticaApi api,
    required String machine,
    required void Function(Map<String, dynamic>) onMessage,
  }) {
    if (!validSessionToken(api.token)) throw ApiException(401, '请先登录');
    if (!validWorkspaceId(api.workspaceId)) {
      throw ApiException(400, '请先选择工作区');
    }
    if (!validShareMachine(machine)) throw ApiException(400, '共享知识库标识无效');
    final base = Uri.parse(api.baseUrl);
    final uri = base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: '${base.path}/api/imind/asr',
      queryParameters: {'share_machine': machine},
    );
    return AsrSession(
      channel: IOWebSocketChannel.connect(
        uri,
        headers: {
          'Authorization': 'Bearer ${api.token}',
          'X-Workspace-ID': api.workspaceId!,
        },
        connectTimeout: const Duration(seconds: 12),
      ),
      onMessage: onMessage,
    );
  }

  final WebSocketChannel channel;
  final void Function(Map<String, dynamic>) onMessage;
  final Duration timeout;
  final _ready = Completer<void>();
  final _done = Completer<void>();
  StreamSubscription<dynamic>? _subscription;
  Object? _failure;
  bool _stopping = false;
  bool _closed = false;
  bool _finished = false;

  Future<void> start() async {
    // Error handlers are installed before a failed handshake can complete.
    final ready = _ready.future;
    ready.ignore();
    _done.future.ignore();
    _subscription = channel.stream.listen(
      _receive,
      onError: (Object _) => _fail(ApiException(0, '语音连接失败，请检查登录和服务配置')),
      onDone: () {
        if (!_closed && !_finished) {
          _fail(ApiException(0, '语音连接已中断，已收到的转写仍可保存'));
        }
      },
    );
    try {
      await channel.ready.timeout(timeout);
      channel.sink.add(
        jsonEncode({
          'type': 'start',
          'sample_rate_hz': 16000,
          'format': 'pcm_s16le',
          'language': 'zh',
        }),
      );
      await ready.timeout(timeout);
    } catch (_) {
      ready.ignore();
      await close();
      throw _failure ?? ApiException(408, '语音服务未就绪，请重试');
    }
  }

  void _receive(dynamic event) {
    if (_closed) return;
    try {
      if (event is! String) throw const FormatException();
      final data = jsonDecode(event);
      if (data is! Map<String, dynamic> || data['type'] is! String) {
        throw const FormatException();
      }
      switch (data['type']) {
        case 'ready':
          if (!_ready.isCompleted) _ready.complete();
        case 'done':
          _finished = true;
          if (!_done.isCompleted) _done.complete();
        case 'error':
          // Never show upstream text, which can contain credential fragments.
          _fail(ApiException(503, '语音识别不可用，已收到的转写仍可保存'));
        case 'partial':
        case 'final':
          if (data['text'] is! String ||
              data['sentence_id'] is! int ||
              (data['start_ms'] != null && data['start_ms'] is! int) ||
              (data['end_ms'] != null && data['end_ms'] is! int)) {
            throw const FormatException();
          }
          onMessage(data);
        default:
          throw const FormatException();
      }
    } on FormatException {
      _fail(ApiException(502, '语音服务返回的数据格式错误'));
    }
  }

  void _fail(Object failure) {
    if (_closed || _failure != null) return;
    _failure = failure;
    if (!_ready.isCompleted) _ready.completeError(failure);
    if (!_done.isCompleted) _done.completeError(failure);
    onMessage({'type': 'error', 'message': '$failure'});
  }

  void sendAudio(List<int> bytes) {
    if (_closed || _stopping || _failure != null || !_ready.isCompleted) return;
    if (bytes.isNotEmpty && bytes.length.isEven) channel.sink.add(bytes);
  }

  Future<void> finish() async {
    if (_closed) return;
    _stopping = true;
    try {
      if (_failure != null) throw _failure!;
      channel.sink.add(jsonEncode({'type': 'stop'}));
      await _done.future.timeout(timeout);
    } on TimeoutException {
      throw ApiException(408, '等待最终转写超时，已收到的转写仍可保存');
    } finally {
      await close();
    }
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    await _subscription?.cancel();
    await channel.sink.close();
  }
}
