import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:web_socket_channel/io.dart';

import 'api.dart';
import 'session.dart';

/// One workspace-wide unread source for all iMind screens.
class ChatUnreadController extends ChangeNotifier {
  ChatUnreadController(this.api) {
    unawaited(_setBadge(0));
    unawaited(_clearAll());
  }

  final MulticaApi api;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get events => _events.stream;
  static const _platform = MethodChannel('imind/chat_notifications');
  final Map<String, Map<String, dynamic>> _chats = {};
  // A temporarily unavailable share must not turn old unread into new alerts.
  final Map<String, int> _lastUnread = {};
  IOWebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _retry;
  String? _identity;
  String? _activeIssueId;
  bool _disposed = false;
  bool _refreshing = false;
  bool _refreshAgain = false;
  bool _hasBaseline = false;
  int _generation = 0;
  int _retryCount = 0;

  static String _key(Map<String, dynamic> row) =>
      '${row['share_machine']}\x00${row['note_id']}';

  int unreadForNote(String? noteId, String? machine) =>
      (_chats['$machine\x00$noteId']?['unread_count'] as int?) ?? 0;

  int get totalUnread => _chats.values.fold<int>(
    0,
    (sum, chat) => sum + (chat['unread_count'] as int),
  );

  void configure(SessionData? session) {
    final workspace = session?.workspaceId;
    final identity = workspace == null
        ? null
        : '${session!.baseUrl}\x00${session.token}\x00$workspace';
    if (identity == _identity) return;
    _generation++;
    _disconnect();
    _identity = identity;
    _activeIssueId = null;
    _hasBaseline = false;
    _chats.clear();
    _lastUnread.clear();
    notifyListeners();
    unawaited(_setBadge(0));
    unawaited(_clearAll());
    if (identity != null) {
      unawaited(_requestPermission());
      unawaited(refresh());
      _connect();
    }
  }

  Future<void> refresh() async {
    if (_disposed || _identity == null) return;
    if (_refreshing) {
      _refreshAgain = true;
      return;
    }
    _refreshing = true;
    final generation = _generation;
    try {
      final rows = await api.noteChatUnread();
      if (_disposed || generation != _generation) return;
      final previous = Map<String, Map<String, dynamic>>.from(_chats);
      _chats
        ..clear()
        ..addEntries(rows.map((row) => MapEntry(_key(row), row)));
      notifyListeners();
      unawaited(_setBadge(totalUnread));
      if (_hasBaseline) {
        for (final old in previous.values) {
          if (!_chats.containsKey(_key(old))) {
            unawaited(_clearChat(old['issue_id'] as String));
          }
        }
        for (final row in rows) {
          final before = _lastUnread[row['issue_id']] ?? 0;
          final after = row['unread_count'] as int;
          if (after > before && row['issue_id'] != _activeIssueId) {
            unawaited(
              _notify(row['issue_id'] as String, row['title'] as String, after),
            );
          } else if (after == 0 && before > 0) {
            unawaited(_clearChat(row['issue_id'] as String));
          }
        }
      }
      for (final row in rows) {
        _lastUnread[row['issue_id'] as String] = row['unread_count'] as int;
      }
      _hasBaseline = true;
    } catch (_) {
      // Preserve the last known counts; reconnect and foreground refresh retry.
    } finally {
      _refreshing = false;
      if (_refreshAgain) {
        _refreshAgain = false;
        unawaited(refresh());
      }
    }
  }

  Future<void> markRead(String issueId) async {
    await api.markNoteChatRead(issueId);
    await refresh();
  }

  void setActiveChat(String? issueId) {
    _activeIssueId = issueId;
  }

  void _connect() {
    if (_disposed ||
        _identity == null ||
        !api.enableRealtime ||
        _channel != null) {
      return;
    }
    final token = api.token;
    final workspace = api.workspaceId;
    if (token == null || workspace == null) return;
    final generation = _generation;
    final httpUri = Uri.parse('${api.baseUrl}/ws');
    final uri = httpUri.replace(
      scheme: httpUri.scheme == 'https' ? 'wss' : 'ws',
      queryParameters: {'workspace_id': workspace},
    );
    try {
      final channel = IOWebSocketChannel.connect(uri);
      _channel = channel;
      channel.ready
          .then((_) {
            if (generation != _generation || _disposed) return;
            channel.sink.add(
              jsonEncode({
                'type': 'auth',
                'payload': {'token': token},
              }),
            );
          })
          .catchError((Object _) {
            if (generation == _generation) _reconnect();
          });
      _subscription = channel.stream.listen(
        (data) {
          if (generation != _generation || data is! String) return;
          try {
            final frame = jsonDecode(data);
            if (frame is! Map<String, dynamic>) return;
            _events.add(frame);
            if (frame['type'] == 'auth_ack') {
              _retryCount = 0;
              unawaited(refresh());
              return;
            }
            final type = frame['type'];
            if (type == 'comment:created' ||
                type == 'comment:deleted' ||
                type == 'group_chat:updated' ||
                type == 'inbox:batch-read' ||
                type == 'inbox:read' ||
                type == 'inbox:unread') {
              unawaited(refresh());
            }
          } catch (_) {}
        },
        onError: (_) => _reconnect(),
        onDone: _reconnect,
        cancelOnError: true,
      );
    } catch (_) {
      _reconnect();
    }
  }

  void _reconnect() {
    if (_disposed || _identity == null) return;
    _closeSocket();
    if (_retry?.isActive == true) return;
    final delay = Duration(seconds: 1 << _retryCount.clamp(0, 4));
    _retryCount++;
    _retry = Timer(delay, () {
      unawaited(refresh());
      _connect();
    });
  }

  void _closeSocket() {
    unawaited(_subscription?.cancel());
    _subscription = null;
    unawaited(_channel?.sink.close());
    _channel = null;
  }

  void _disconnect() {
    _retry?.cancel();
    _retry = null;
    _closeSocket();
  }

  Future<void> _setBadge(int count) async {
    try {
      await _platform.invokeMethod<void>('setBadge', {'count': count});
    } catch (_) {}
  }

  Future<void> _requestPermission() async {
    try {
      await _platform.invokeMethod<void>('requestPermission');
    } catch (_) {}
  }

  Future<void> _clearChat(String issueId) async {
    try {
      await _platform.invokeMethod<void>('clearChat', {'issueId': issueId});
    } catch (_) {}
  }

  Future<void> _clearAll() async {
    try {
      await _platform.invokeMethod<void>('clearAll');
    } catch (_) {}
  }

  Future<void> _notify(String issueId, String title, int count) async {
    try {
      await _platform.invokeMethod<void>('notify', {
        'issueId': issueId,
        'title': title,
        'count': count,
        'total': totalUnread,
      });
    } catch (_) {}
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _disconnect();
    unawaited(_events.close());
    super.dispose();
  }
}

class ChatUnreadScope extends InheritedNotifier<ChatUnreadController> {
  const ChatUnreadScope({
    super.key,
    required ChatUnreadController controller,
    required super.child,
  }) : super(notifier: controller);

  static ChatUnreadController? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ChatUnreadScope>()?.notifier;
}
