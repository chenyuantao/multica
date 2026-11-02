import 'dart:async';
import 'dart:convert';
import 'dart:math' show min;

import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/io.dart';

import 'api.dart';
import 'action_button.dart';
import 'note_actions.dart';
import 'ai_composer.dart';
import 'note_quotes.dart';
import 'agent_mentions.dart';
import 'note_chat_prefetch.dart';
import 'offline_cache.dart';
import 'chat_unread.dart';
import 'chat_time.dart';
import 'input_insets.dart';
import 'markdown_style.dart';
import 'run_progress.dart';
import 'voice_input.dart';

import 'package:record/record.dart';

const _aiInk = Color(0xFF1C1C1E);
const _aiMuted = Color(0xFF8E8E93);
const _aiBg = Color(0xFFF2F2F6);
const _aiRed = Color(0xFFE5484D);

/// Opens the persisted, file-specific Multica group chat for an iMind note.
Future<void> showNoteAiChat(
  BuildContext context, {
  required MulticaApi api,
  required String machine,
  required Map<String, dynamic> note,
  String? initialMessage,
  NoteChatPrefetch? prefetch,
  NoteQuoteDraft? quotes,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  backgroundColor: Colors.white,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
  ),
  builder: (_) => NoteAiChatSheet(
    api: api,
    unread: ChatUnreadScope.maybeOf(context),
    machine: machine,
    note: note,
    initialMessage: initialMessage,
    prefetch: prefetch,
    quotes: quotes,
  ),
);

class NoteAiChatSheet extends StatefulWidget {
  const NoteAiChatSheet({
    super.key,
    required this.api,
    required this.machine,
    required this.note,
    this.initialMessage,
    this.prefetch,
    this.quotes,
    this.voiceRecorder,
    this.voiceSessionFactory,
    this.unread,
    this.conversation,
  });
  final MulticaApi api;
  final String machine;
  final Map<String, dynamic> note;
  final String? initialMessage;
  final NoteChatPrefetch? prefetch;
  final NoteQuoteDraft? quotes;
  final AudioRecorder? voiceRecorder;
  final VoiceSessionFactory? voiceSessionFactory;
  final ChatUnreadController? unread;

  /// When supplied, opens an existing issue conversation without note setup.
  final Map<String, dynamic>? conversation;

  @override
  State<NoteAiChatSheet> createState() => _NoteAiChatSheetState();
}

/// Full-page chat for an existing conversation, such as a workspace issue chat.
/// This shares message, history, realtime, mention, and retry behavior with the
/// note chat sheet while skipping note-specific setup.
class ConversationChatPage extends StatelessWidget {
  const ConversationChatPage({
    super.key,
    required this.api,
    required this.machine,
    required this.conversation,
  });

  final MulticaApi api;
  final String machine;
  final Map<String, dynamic> conversation;

  @override
  Widget build(BuildContext context) => NoteAiChatSheet(
    api: api,
    machine: machine,
    note: const {},
    conversation: conversation,
    unread: ChatUnreadScope.maybeOf(context),
  );
}

class _PendingMessage {
  _PendingMessage(this.text) : clientId = const Uuid().v4();
  final String text;
  final String clientId;
  bool sending = true;
  String? error;
}

class _NoteAiChatSheetState extends State<NoteAiChatSheet> {
  final _input = TextEditingController();
  final _mentions = AgentMentionDraft();
  List<Map<String, dynamic>> _agents = [];
  bool _agentsLoading = false;
  String? _agentsError;
  late final VoiceInput _voice;
  final _scroll = ScrollController();
  final _messages = <Map<String, dynamic>>[];
  final _pending = <_PendingMessage>[];
  final _dispatchStates = <String, String>{};
  final _retryingComments = <String>{};
  String? _issueId;
  String? _userId;
  final _members = <String, Map<String, dynamic>>{};
  final _agentProfiles = <String, Map<String, dynamic>>{};
  String? _error;
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  bool _connecting = false;
  final Set<String> _stoppingRuns = {};
  List<Map<String, dynamic>> _runs = [];
  final _agentNames = <String, String>{};
  bool _agentNamesRequested = false;
  String? _runError;
  IOWebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  StreamSubscription<Map<String, dynamic>>? _globalSubscription;
  Timer? _retry;
  Timer? _historyRetry;
  Timer? _stopPoll;
  final _terminalStatuses = <String, String>{};
  int _retryCount = 0;
  bool _disposed = false;
  bool _initialMessageSent = false;
  double _keyboardInset = 0;
  bool _prefetchUsed = false;
  OfflineResource<Map<String, dynamic>>? _history;

  @override
  void initState() {
    super.initState();
    _voice = VoiceInput(
      api: widget.api,
      machine: widget.machine,
      input: _input,
      recorder: widget.voiceRecorder,
      sessionFactory: widget.voiceSessionFactory,
    )..addListener(_voiceChanged);
    _input.addListener(_composerChanged);
    _load();
  }

  void _composerChanged() {
    _mentions.update(_input.text);
    if (!_disposed) setState(() {});
  }

  void _voiceChanged() {
    if (!_disposed) setState(() {});
  }

  @override
  void dispose() {
    _disposed = true;
    _history?.dispose();
    widget.unread?.setActiveChat(null);
    _retry?.cancel();
    _historyRetry?.cancel();
    _stopPoll?.cancel();
    unawaited(_subscription?.cancel());
    unawaited(_globalSubscription?.cancel());
    unawaited(_channel?.sink.close());
    _voice.dispose();
    _input.removeListener(_composerChanged);
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final conversation = widget.conversation;
      if (conversation != null) {
        final issueId = conversation['issue_id'] ?? conversation['id'];
        if (issueId is! String || !validWorkspaceId(issueId)) {
          throw ApiException(400, '无法打开此对话');
        }
        _issueId = issueId;
        widget.unread?.setActiveChat(_issueId);
        unawaited(widget.unread?.refresh() ?? Future<void>.value());
        unawaited(_loadUser(widget.api.getMe()));
        unawaited(_loadMembers());
        unawaited(_loadAgentNames());
        if (widget.unread != null) {
          _globalSubscription = widget.unread!.events.listen(
            (frame) => _onFrame(jsonEncode(frame)),
          );
        } else {
          _connect();
        }
        unawaited(_loadRuns());
        await _loadLatest();
        if (!_disposed) unawaited(_refreshHistory());
        return;
      }
      final noteId = '${widget.note['id'] ?? ''}';
      if (!validWorkspaceId(noteId)) throw ApiException(400, '请先保存笔记再使用 AI+');
      final prepared =
          !_prefetchUsed &&
              (widget.prefetch?.matches(
                    widget.api,
                    widget.machine,
                    widget.note,
                  ) ??
                  false)
          ? widget.prefetch!
          : NoteChatPrefetch(widget.api, widget.machine, widget.note);
      _prefetchUsed = true;
      final chat = await prepared.chat;
      if (_disposed) return;
      _issueId = chat['issue_id'] as String;
      widget.unread?.setActiveChat(_issueId);
      unawaited(widget.unread?.refresh() ?? Future<void>.value());
      unawaited(_loadUser(prepared.me));
      unawaited(_loadMembers());
      unawaited(_loadAgentNames(prepared.agents));
      if (widget.unread != null) {
        _globalSubscription = widget.unread!.events.listen(
          (frame) => _onFrame(jsonEncode(frame)),
        );
      } else {
        _connect();
      }
      unawaited(_loadRuns(prepared.runs));
      await _loadLatest(initial: prepared.history);
      if (!_disposed &&
          !_initialMessageSent &&
          (widget.initialMessage?.trim().isNotEmpty ?? false)) {
        _initialMessageSent = true;
        _input.text = widget.initialMessage!.trim();
        await _send();
      }
      // Send any initial selection against confirmed history before a new read
      // temporarily locks mutations while refreshing the prepared window.
      if (!_disposed) unawaited(_refreshHistory());
    } catch (error) {
      if (!_disposed) setState(() => _error = '$error');
    } finally {
      if (!_disposed) {
        setState(() => _loading = false);
        _scrollToEnd();
      }
    }
  }

  Future<void> _loadUser(Future<Map<String, dynamic>> request) async {
    try {
      final me = await request;
      if (!_disposed) {
        setState(() {
          _userId = me['id'] as String;
          _members[_userId!] = me;
        });
      }
    } catch (error) {
      if (!_disposed) setState(() => _error = '$error');
    }
  }

  Future<void> _loadMembers() async {
    try {
      final members = await widget.api.workspaceMembers();
      if (!_disposed) {
        setState(() {
          for (final member in members) {
            _members[member['user_id'] as String] = member;
          }
        });
      }
    } catch (_) {
      // Missing profiles must not prevent reading or sending messages.
    }
  }

  Future<void> _markRead(String issueId) async {
    if (!(_history?.networkReady ?? false)) return;
    try {
      await (widget.unread?.markRead(issueId) ??
          widget.api.markNoteChatRead(issueId));
    } catch (_) {
      // Keep the server unread state when marking read fails.
    }
  }

  Future<void> _loadLatest({
    bool replace = true,
    Future<Map<String, dynamic>>? initial,
  }) async {
    final issueId = _issueId;
    if (issueId == null) return;
    _history ??= OfflineResource<Map<String, dynamic>>(
      scope: OfflineCacheScope.capture(widget.api, machine: widget.machine),
      key: 'chat:$issueId:history',
      decode: (value) {
        final page = Map<String, dynamic>.from(value as Map);
        if (page['comments'] is! List || page['has_more'] is! bool) {
          throw const FormatException('Invalid cached chat history');
        }
        page['comments'] = (page['comments'] as List)
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        return page;
      },
    );
    Object? failure;
    await _history!.load(
      network: () async {
        var page = await (initial ?? widget.api.noteChatHistory(issueId));
        final incoming = (page['comments'] as List)
            .cast<Map<String, dynamic>>()
            .toList();
        // Refresh the full visible window so missed removals disappear too.
        final oldest = _messages.isEmpty
            ? null
            : '${_messages.first['created_at']}';
        while (!replace &&
            page['has_more'] == true &&
            incoming.isNotEmpty &&
            oldest != null &&
            '${incoming.first['created_at']}'.compareTo(oldest) > 0) {
          final first = incoming.first;
          page = await widget.api.noteChatHistory(
            issueId,
            beforeCreatedAt: first['created_at'] as String?,
            beforeId: first['id'] as String?,
          );
          final older = (page['comments'] as List).cast<Map<String, dynamic>>();
          if (older.isEmpty) break;
          incoming.insertAll(0, older);
        }
        return {'comments': incoming, 'has_more': page['has_more'] == true};
      },
      onData: (page, fromCache) {
        if (_disposed ||
            !_history!.scope.matches(widget.api, machine: widget.machine)) {
          _history?.dispose();
          return;
        }
        final incoming = (page['comments'] as List)
            .cast<Map<String, dynamic>>();
        setState(() {
          for (final message in incoming) {
            final status = message['imind_agent_status'];
            if (status is String) {
              _dispatchStates[message['id'] as String] = status;
            }
          }
          _messages
            ..clear()
            ..addAll(incoming);
          _hasMore = page['has_more'] == true;
          _loading = false;
        });
        _scrollToEnd();
        if (!fromCache) unawaited(_markRead(issueId));
      },
      onError: (error) => failure = error,
    );
    if (failure != null) throw failure!;
  }

  Future<void> _refreshHistory() async {
    try {
      await _loadLatest(replace: false);
      if (_disposed) return;
      _historyRetry?.cancel();
      setState(() => _error = null);
    } catch (error) {
      if (_disposed) return;
      setState(() {
        _error = '暂时无法同步群聊，正在重试：$error';
        if (error is ApiException &&
            (error.status == 404 || error.status == 403)) {
          _messages.clear();
        }
      });
      if (error is ApiException && error.status == 401) return;
      _historyRetry?.cancel();
      _historyRetry = Timer(
        const Duration(seconds: 2),
        () => unawaited(_refreshHistory()),
      );
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_disposed && _scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.minScrollExtent,
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _loadMore() async {
    if (!(_history?.networkReady ?? false)) return;
    if (_loadingMore || !_hasMore || _messages.isEmpty || _issueId == null) {
      return;
    }
    setState(() => _loadingMore = true);
    try {
      final oldest = _messages.first;
      final page = await widget.api.noteChatHistory(
        _issueId!,
        beforeCreatedAt: oldest['created_at'] as String?,
        beforeId: oldest['id'] as String?,
      );
      if (_disposed) return;
      setState(() {
        final known = _messages.map((m) => m['id']).toSet();
        _messages.insertAll(
          0,
          (page['comments'] as List).cast<Map<String, dynamic>>().where(
            (m) => !known.contains(m['id']),
          ),
        );
        _hasMore = page['has_more'] == true;
      });
      _persistHistory();
    } catch (error) {
      if (!_disposed) setState(() => _error = '$error');
    } finally {
      if (!_disposed) setState(() => _loadingMore = false);
    }
  }

  String _runName(Map<String, dynamic> run) {
    final cached = _agentNames[run['agent_id']];
    if (cached != null) return cached;
    final name = run['agent_name'];
    return name is String && name.trim().isNotEmpty ? name : 'Agent';
  }

  Future<void> _loadAgentNames([
    Future<List<Map<String, dynamic>>>? initial,
  ]) async {
    if (_agentNamesRequested) return;
    _agentNamesRequested = true;
    setState(() {
      _agentsLoading = true;
      _agentsError = null;
    });
    try {
      final agents = await (initial ?? widget.api.workspaceAgents());
      if (_disposed) return;
      setState(() {
        _agents = agents
            .where(
              (agent) =>
                  validWorkspaceId(agent['id']) &&
                  agent['name'] is String &&
                  (agent['name'] as String).trim().isNotEmpty &&
                  !(agent['name'] as String).contains(RegExp(r'[\r\n]')) &&
                  agent['archived_at'] == null,
            )
            .toList();
        for (final agent in agents) {
          final id = agent['id'];
          final name = agent['name'];
          if (id is String && name is String && name.trim().isNotEmpty) {
            _agentNames[id] = name;
            _agentProfiles[id] = agent;
          }
        }
        _runs = [
          for (final run in _runs) {...run, 'agent_name': _runName(run)},
        ];
      });
    } catch (_) {
      if (!_disposed) setState(() => _agentsError = '无法加载 Agent');
    } finally {
      if (!_disposed) setState(() => _agentsLoading = false);
    }
  }

  Future<void> _loadRuns([Future<List<Map<String, dynamic>>>? initial]) async {
    final issueId = _issueId;
    if (issueId == null) return;
    try {
      final runs = await (initial ?? widget.api.noteChatRuns(issueId));
      if (!_disposed) {
        setState(() {
          _runs = [
            for (final run in runs)
              {
                ...run,
                'status': _terminalStatuses[run['id']] ?? run['status'],
                'agent_name': _runName(run),
              },
          ];
          _stoppingRuns.removeWhere(
            (id) => !_runs.any((run) => run['id'] == id && _active(run)),
          );
          _runError = null;
        });
      }
    } catch (error) {
      if (!_disposed) setState(() => _runError = '$error');
    }
    _stopPoll?.cancel();
    if (!_disposed && _stoppingRuns.isNotEmpty) {
      _stopPoll = Timer(
        const Duration(seconds: 1),
        () => unawaited(_loadRuns()),
      );
    }
  }

  void _connect() {
    if (_disposed ||
        !widget.api.enableRealtime ||
        _connecting ||
        _issueId == null) {
      return;
    }
    final token = widget.api.token;
    final workspaceId = widget.api.workspaceId;
    if (token == null || workspaceId == null) return;
    _connecting = true;
    final httpUri = Uri.parse('${widget.api.baseUrl}/ws');
    final uri = httpUri.replace(
      scheme: httpUri.scheme == 'https' ? 'wss' : 'ws',
      queryParameters: {'workspace_id': workspaceId},
    );
    final channel = IOWebSocketChannel.connect(uri);
    _channel = channel;
    channel.ready
        .then((_) {
          channel.sink.add(
            jsonEncode({
              'type': 'auth',
              'payload': {'token': token},
            }),
          );
          _connecting = false;
          _retryCount = 0;
        })
        .catchError((_) {
          _connecting = false;
        });
    _subscription = channel.stream.listen(
      _onFrame,
      onError: (_) => _scheduleReconnect(),
      onDone: _scheduleReconnect,
      cancelOnError: true,
    );
  }

  void _scheduleReconnect() {
    _connecting = false;
    if (_disposed || _retry?.isActive == true) return;
    final delay = Duration(seconds: (1 << _retryCount.clamp(0, 4)));
    _retryCount++;
    _retry = Timer(delay, () async {
      try {
        await _loadLatest(replace: false);
        await _loadRuns();
      } catch (_) {}
      _connect();
    });
  }

  void _onFrame(dynamic data) {
    if (_disposed || data is! String) return;
    Map<String, dynamic> frame;
    try {
      final decoded = jsonDecode(data);
      if (decoded is! Map<String, dynamic>) return;
      frame = decoded;
    } catch (_) {
      return;
    }
    final type = frame['type'];
    final payload = frame['payload'];
    if (type == 'auth_ack') {
      _connecting = false;
      unawaited(_refreshHistory());
      unawaited(_loadRuns());
      return;
    }
    if (payload is! Map<String, dynamic>) {
      return;
    }
    final nestedComment = payload['comment'];
    final issueId =
        payload['issue_id'] ??
        (nestedComment is Map ? nestedComment['issue_id'] : null);
    if (issueId != _issueId) return;
    if (type == 'comment:created' || type == 'comment:updated') {
      final comment = nestedComment is Map<String, dynamic>
          ? nestedComment
          : payload;
      _upsert(comment);
      if (type == 'comment:created') {
        unawaited(_markRead(_issueId!));
      }
      unawaited(_loadRuns());
    } else if (type == 'comment:deleted') {
      final id = payload['comment_id'] ?? payload['id'];
      if (id is String && !_disposed) {
        setState(() => _messages.removeWhere((m) => m['id'] == id));
        _persistHistory();
      }
    } else if (type == 'group_chat:updated') {
      unawaited(_refreshHistory());
      unawaited(_loadRuns());
    } else if (type == 'imind:message_status') {
      final commentId = payload['comment_id'];
      final status = payload['status'];
      if (commentId is String &&
          (status == 'queued' || status == 'unavailable')) {
        setState(() => _dispatchStates[commentId] = status as String);
      }
    } else if ('$type'.startsWith('task:')) {
      unawaited(_loadRuns());
    }
  }

  void _persistHistory() {
    final history = _history;
    if (history == null ||
        !history.scope.matches(widget.api, machine: widget.machine)) {
      return;
    }
    unawaited(
      history.updateCache({
        'comments': List<Map<String, dynamic>>.of(_messages),
        'has_more': _hasMore,
      }),
    );
  }

  void _upsert(Map<String, dynamic> comment) {
    if (comment['issue_id'] != _issueId ||
        comment['id'] is! String ||
        _disposed) {
      return;
    }
    setState(() {
      final dispatchStatus = comment['imind_agent_status'];
      if (dispatchStatus == 'queued' || dispatchStatus == 'unavailable') {
        _dispatchStates[comment['id'] as String] = dispatchStatus as String;
      }
      final index = _messages.indexWhere((m) => m['id'] == comment['id']);
      if (index == -1) {
        _messages.add(comment);
        _messages.sort(
          (a, b) => '${a['created_at']}'.compareTo('${b['created_at']}'),
        );
      } else {
        _messages[index] = comment;
      }
    });
    _persistHistory();
  }

  bool _allowMutation() => allowNetworkAction(
    context,
    (_history?.networkReady ?? false) &&
        (_history?.scope.matches(widget.api, machine: widget.machine) ?? false),
  );

  Future<void> _send([_PendingMessage? retry]) async {
    if (!_allowMutation()) return;
    if (retry == null && _voice.active) return;
    final message = _mentions.encode(_input.text).trim();
    final text = retry?.text ?? widget.quotes?.compose(message) ?? message;
    if (text.isEmpty || _issueId == null) return;
    final pending = retry ?? _PendingMessage(text);
    if (retry == null) {
      setState(() {
        _pending.add(pending);
        _input.clear();
        widget.quotes?.markSent(widget.quotes!.pending);
      });
      _scrollToEnd();
    } else {
      setState(() {
        pending.sending = true;
        pending.error = null;
      });
    }
    try {
      final result = await widget.api.sendNoteChatMessage(
        _issueId!,
        text,
        clientId: pending.clientId,
      );
      if (_disposed) return;
      setState(() => _pending.remove(pending));
      _upsert(result);
      _scrollToEnd();
      await _loadRuns();
    } catch (error) {
      if (!_disposed) {
        setState(() {
          pending.sending = false;
          pending.error = '$error';
        });
      }
    }
  }

  Future<void> _cancel(Map<String, dynamic> run) async {
    if (!_allowMutation()) return;
    final taskId = run['id'] ?? run['task_id'];
    if (taskId is! String ||
        _issueId == null ||
        _stoppingRuns.contains(taskId)) {
      return;
    }
    setState(() => _stoppingRuns.add(taskId));
    try {
      final result = await widget.api.cancelNoteChatRun(_issueId!, taskId);
      if (_disposed) return;
      final status = result['status'];
      if (const {'completed', 'failed', 'cancelled'}.contains(status)) {
        _terminalStatuses[taskId] = status as String;
      }
      await _loadRuns();
    } catch (error) {
      if (!_disposed) {
        setState(() {
          _stoppingRuns.remove(taskId);
          _error = '无法终止运行：$error';
        });
      }
    }
  }

  Future<void> _retryRun(Map<String, dynamic> run) async {
    if (!_allowMutation()) return;
    final taskId = run['id'] ?? run['task_id'];
    final commentId = run['trigger_comment_id'];
    if (taskId is! String || commentId is! String || _issueId == null) return;
    try {
      await widget.api.retryNoteChatRun(_issueId!, taskId, commentId);
      await _loadRuns();
    } catch (error) {
      if (!_disposed) setState(() => _error = '无法重试 Agent 运行：$error');
    }
  }

  Future<void> _retryDispatch(String commentId) async {
    if (!_allowMutation()) return;
    if (_issueId == null || _retryingComments.contains(commentId)) return;
    setState(() => _retryingComments.add(commentId));
    try {
      final result = await widget.api.retryNoteChatDispatch(
        _issueId!,
        commentId,
      );
      if (!_disposed && result['status'] == 'queued') {
        setState(() => _dispatchStates[commentId] = 'queued');
      }
    } catch (error) {
      if (!_disposed) {
        setState(() => _error = 'Agent 暂时不可用，消息已保留。可以稍后重试。 $error');
      }
    } finally {
      if (!_disposed) setState(() => _retryingComments.remove(commentId));
    }
  }

  Future<void> _openDoc(_DocNote note) async {
    try {
      final file = await widget.api.getDocFile(note.path);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(note.name, maxLines: 2, overflow: TextOverflow.ellipsis),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: MarkdownBody(
                data: '${file['content'] ?? ''}',
                styleSheet: imindMarkdownStyle(context),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('关闭'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (mounted) setState(() => _error = '无法打开文档：$error');
    }
  }

  bool _active(Map<String, dynamic> run) => const {
    'queued',
    'dispatched',
    'waiting_local_directory',
    'deferred',
    'running',
  }.contains(run['status']);
  Widget _agentPicker(AgentMentionQuery query) {
    final matches = _agents
        .where(
          (a) => (a['name'] as String).toLowerCase().contains(
            query.query.toLowerCase(),
          ),
        )
        .toList();
    return TextFieldTapRegion(
      child: Material(
        color: Colors.white,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 160),
          child: _agentsLoading
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: LinearProgressIndicator(),
                )
              : _agentsError != null
              ? _notice(
                  _agentsError!,
                  actionLabel: '重试',
                  action: () {
                    _agentNamesRequested = false;
                    unawaited(_loadAgentNames());
                  },
                )
              : matches.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('没有匹配的 Agent'),
                )
              : ListView(
                  shrinkWrap: true,
                  primary: false,
                  padding: EdgeInsets.zero,
                  children: [
                    for (final agent in matches)
                      ListTile(
                        dense: true,
                        title: Text(agent['name'] as String),
                        subtitle:
                            _agents
                                    .where((a) => a['name'] == agent['name'])
                                    .length >
                                1
                            ? Text(agent['id'] as String)
                            : null,
                        onTap: () {
                          _input.value = _mentions.pick(
                            _input.value,
                            agent['id'] as String,
                            agent['name'] as String,
                          );
                        },
                      ),
                  ],
                ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final mention = _voice.active ? null : _mentions.active(_input.value);
    final noteTitle = '${widget.note['title'] ?? '未命名'}';
    final fullPage = widget.conversation != null;
    final media = MediaQuery.of(context);
    if (_keyboardInset != media.viewInsets.bottom) {
      _keyboardInset = media.viewInsets.bottom;
      if (_keyboardInset > 0) _scrollToEnd();
    }
    final availableHeight =
        media.size.height - inputBottomInset(context) - media.padding.top;
    final chatContent = Column(
      children: [
        if (!fullPage) ...[
          const SizedBox(height: 8),
          Container(
            width: 38,
            height: 5,
            decoration: BoxDecoration(
              color: const Color(0xFFD8D8DD),
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 15, 12, 0),
            child: Row(
              children: [
                const Icon(Icons.auto_awesome, color: Color(0xFF6E56CF)),
                const SizedBox(width: 8),
                const Text(
                  'AI+ 群聊',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
                const Spacer(),
                AppActionButton(
                  tooltip: '关闭',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '文件：$noteTitle',
                style: const TextStyle(color: _aiMuted),
              ),
            ),
          ),
        ],
        if (_error != null)
          _notice(
            _error!,
            action: _issueId == null
                ? () {
                    setState(() {
                      _error = null;
                      _loading = true;
                    });
                    unawaited(_load());
                  }
                : fullPage
                ? () {
                    unawaited(_refreshHistory());
                    unawaited(_loadRuns());
                  }
                : null,
            actionLabel: '重试',
            dismiss: () => setState(() => _error = null),
          ),
        if (_loading)
          const Expanded(child: Center(child: CircularProgressIndicator()))
        else if (_issueId == null)
          const Expanded(child: Center(child: Text('无法打开此文件的群聊')))
        else ...[
          if (_runError != null)
            _notice('无法读取 Agent 运行状态。', action: _loadRuns, actionLabel: '重试'),
          Expanded(
            child: NotificationListener<ScrollNotification>(
              onNotification: (event) {
                if (event.metrics.extentAfter <= 24 && _hasMore) {
                  unawaited(_loadMore());
                }
                return false;
              },
              child: ListView(
                controller: _scroll,
                // Keep the newest message anchored as the keyboard resizes the list.
                reverse: true,
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
                children: [
                  if (_loadingMore)
                    const Center(
                      child: Padding(
                        padding: EdgeInsets.all(8),
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  if (_messages.isEmpty && _pending.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Center(
                        child: Text(fullPage ? '开始讨论' : '围绕这份文件开始讨论'),
                      ),
                    ),
                  ..._conversation(),
                  for (final pending in _pending) _pendingBubble(pending),
                ].reversed.toList(),
              ),
            ),
          ),
          if (mention != null) _agentPicker(mention),
          if (_voice.error != null) _notice(_voice.error!),
          if (_voice.active)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                _voice.connecting
                    ? '正在连接语音服务…'
                    : _voice.stopping
                    ? '正在完成识别…'
                    : '正在聆听，识别文字将填入输入框',
              ),
            ),
          Padding(
            key: const ValueKey('ai-composer'),
            padding: EdgeInsets.fromLTRB(16, 2, 16, fullPage ? 8 : 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (widget.quotes != null)
                  ListenableBuilder(
                    listenable: widget.quotes!,
                    builder: (context, _) => Wrap(
                      spacing: 8,
                      children: [
                        for (final quote in widget.quotes!.pending)
                          InputChip(
                            key: ValueKey('quote-chip-${quote.number}'),
                            shape: const StadiumBorder(),
                            label: Text('${quote.number}'),
                            tooltip: '${quote.markdown}\n${quote.instruction}',
                            deleteButtonTooltipMessage: '删除引用 ${quote.number}',
                            onDeleted: () => widget.quotes!.remove(quote),
                          ),
                      ],
                    ),
                  ),
                AiComposer(
                  controller: _input,
                  inputFormatters: [
                    if (_voice.active)
                      TextInputFormatter.withFunction(
                        (oldValue, _) => oldValue,
                      ),
                  ],
                  onSend: _issueId == null || _voice.active
                      ? null
                      : () => _send(),
                  voiceActive: _voice.active,
                  onVoice:
                      widget.machine.trim().isEmpty ||
                          _issueId == null ||
                          _voice.connecting ||
                          _voice.stopping
                      ? null
                      : () {
                          if (_voice.active) {
                            _voice.stop();
                          } else if (_allowMutation()) {
                            _voice.start();
                          }
                        },
                ),
              ],
            ),
          ),
        ],
      ],
    );
    if (fullPage) {
      final title = '${widget.conversation!['title'] ?? '对话'}'.trim();
      return Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          centerTitle: true,
          title: DetailTitle(title.isEmpty ? '对话' : title),
          leading: AppActionButton(
            tooltip: '返回',
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.arrow_back),
          ),
        ),
        body: SafeArea(child: chatContent),
      );
    }
    return Padding(
      padding: EdgeInsets.only(bottom: inputBottomInset(context)),
      child: SizedBox(
        height: min(media.size.height * .9, availableHeight),
        child: chatContent,
      ),
    );
  }

  Widget _notice(
    String text, {
    VoidCallback? action,
    String? actionLabel,
    VoidCallback? dismiss,
  }) => Container(
    width: double.infinity,
    margin: const EdgeInsets.fromLTRB(16, 0, 16, 6),
    padding: const EdgeInsets.fromLTRB(10, 2, 4, 2),
    decoration: BoxDecoration(
      color: const Color(0xFFFFF3F0),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      children: [
        Expanded(
          child: Text(
            text,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: _aiInk, fontSize: 12),
          ),
        ),
        if (action != null)
          AppActionButton(
            tooltip: actionLabel ?? '重试',
            onPressed: action,
            icon: const Icon(Icons.refresh),
          ),
        if (dismiss != null)
          AppActionButton(
            tooltip: '关闭提示',
            onPressed: dismiss,
            icon: const Icon(Icons.close, size: 16),
          ),
      ],
    ),
  );

  Map<String, dynamic>? _authorProfile(Map<String, dynamic> message) =>
      message['author_type'] == 'agent'
      ? _agentProfiles[message['author_id']]
      : _members[message['author_id']];

  String _authorName(Map<String, dynamic> message) {
    final name = _authorProfile(message)?['name'];
    if (name is String && name.trim().isNotEmpty) return name;
    return switch (message['author_type']) {
      'agent' => 'Agent',
      'system' => '系统',
      _ => '成员',
    };
  }

  Widget _authorAvatar(Map<String, dynamic> message, String name) {
    final url = _authorProfile(message)?['avatar_url'];
    final uri = url is String && url.isNotEmpty
        ? Uri.tryParse(widget.api.baseUrl)?.resolve(url)
        : null;
    final fallback = Center(
      child: message['author_type'] == 'agent'
          ? const Icon(Icons.smart_toy_outlined, size: 22, color: _aiMuted)
          : Text(name.characters.first, style: const TextStyle(fontSize: 18)),
    );
    return Semantics(
      label: '$name 的头像',
      image: true,
      excludeSemantics: true,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: SizedBox(
          width: 36,
          height: 36,
          child: ColoredBox(
            color: _aiBg,
            child:
                uri != null && (uri.scheme == 'http' || uri.scheme == 'https')
                ? Image.network(
                    uri.toString(),
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => fallback,
                  )
                : fallback,
          ),
        ),
      ),
    );
  }

  Widget _selectableMessage(String content, Color color) => _MessageTapTarget(
    onDoubleTap: () {
      FocusManager.instance.primaryFocus?.unfocus();
      Navigator.of(context).push<void>(
        MaterialPageRoute(
          fullscreenDialog: true,
          builder: (pageContext) => Scaffold(
            key: const ValueKey('ai-message-fullscreen'),
            backgroundColor: Colors.white,
            body: SafeArea(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  SingleChildScrollView(
                    padding: const EdgeInsets.all(24),
                    child: SelectionArea(
                      child: _renderContent(content, _aiInk),
                    ),
                  ),
                  Positioned(
                    top: 12,
                    left: 12,
                    child: AppActionButton(
                      key: const ValueKey('ai-message-close'),
                      onPressed: () => Navigator.of(pageContext).pop(),
                      tooltip: '关闭',
                      icon: const Icon(Icons.close),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    },
    child: SelectionArea(child: _renderContent(content, color)),
  );

  Widget _messageBubble(Map<String, dynamic> message) {
    final mine =
        message['author_type'] == 'member' && message['author_id'] == _userId;
    final content = '${message['content'] ?? ''}';
    final sourceRun = message['author_type'] == 'agent'
        ? _runs
              .where((run) => run['id'] == message['source_task_id'])
              .firstOrNull
        : null;
    final name = _authorName(message);
    final bubble = Container(
      constraints: const BoxConstraints(maxWidth: 320),
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: mine ? const Color(0xFF23262C) : _aiBg,
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(mine ? 18 : 6),
          bottomRight: Radius.circular(mine ? 6 : 18),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _selectableMessage(content, mine ? Colors.white : _aiInk),
          if (sourceRun != null) _runControls(sourceRun),
          if (mine && _dispatchStates[message['id']] == 'unavailable')
            TextButton.icon(
              onPressed: _retryingComments.contains(message['id'])
                  ? null
                  : () => _retryDispatch(message['id'] as String),
              icon: _retryingComments.contains(message['id'])
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.refresh, size: 16),
              label: const Text('Agent 暂不可用 · 重试'),
              style: TextButton.styleFrom(
                foregroundColor: _aiRed,
                padding: EdgeInsets.zero,
              ),
            ),
        ],
      ),
    );
    return Padding(
      key: ValueKey('chat-message-${message['id']}'),
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisAlignment: mine
            ? MainAxisAlignment.end
            : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!mine) ...[
            _authorAvatar(message, name),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: mine
                  ? CrossAxisAlignment.end
                  : CrossAxisAlignment.start,
              children: [
                if (!mine)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: Text(
                      name,
                      style: const TextStyle(color: _aiMuted, fontSize: 12),
                    ),
                  ),
                bubble,
              ],
            ),
          ),
        ],
      ),
    );
  }

  Iterable<Widget> _conversation() sync* {
    final linked = _messages
        .where((message) => message['author_type'] == 'agent')
        .map((message) => message['source_task_id'])
        .whereType<String>()
        .toSet();
    final placeholders = _runs
        .where(
          (run) =>
              !linked.contains(run['id']) &&
              (_active(run) || run['status'] == 'failed'),
        )
        .toList();
    Map<String, dynamic>? previous;
    for (final message in _messages) {
      if (needsChatTimeSeparator(
        previous?['created_at'],
        message['created_at'],
      )) {
        yield Padding(
          key: ValueKey('chat-time-${message['id']}'),
          padding: const EdgeInsets.fromLTRB(0, 12, 0, 18),
          child: Text(
            chatTimeLabel(
              message['created_at'],
              previous: previous?['created_at'],
            ),
            textAlign: TextAlign.center,
            style: const TextStyle(color: _aiMuted, fontSize: 12),
          ),
        );
      }
      yield _messageBubble(message);
      previous = message;
      for (final run in placeholders.where(
        (run) => run['trigger_comment_id'] == message['id'],
      )) {
        yield _runBubble(run);
      }
    }
    final knownMessages = _messages.map((message) => message['id']).toSet();
    for (final run in placeholders.where(
      (run) => !knownMessages.contains(run['trigger_comment_id']),
    )) {
      yield _runBubble(run);
    }
  }

  Future<void> _openProgress(Map<String, dynamic> run) async {
    final issueId = _issueId;
    if (issueId == null) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => NoteRunProgressPage(
          api: widget.api,
          issueId: issueId,
          initialRun: run,
        ),
      ),
    );
    if (!_disposed) await _loadRuns();
  }

  Widget _runBubble(Map<String, dynamic> run) => Align(
    alignment: Alignment.centerLeft,
    child: Container(
      key: ValueKey('run-message-${run['id']}'),
      constraints: const BoxConstraints(maxWidth: 320),
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 4),
      decoration: BoxDecoration(
        color: _aiBg,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${run['agent_name'] ?? 'Agent'}',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          Text(
            run['status'] == 'failed'
                ? '运行失败'
                : _statusLabel('${run['status']}'),
          ),
          _runControls(run),
        ],
      ),
    ),
  );

  Widget _runControls(Map<String, dynamic> run) {
    final taskId = '${run['id'] ?? run['task_id'] ?? ''}';
    final agent = '${run['agent_name'] ?? 'Agent'}';
    final stopping = _stoppingRuns.contains(taskId);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextButton.icon(
          onPressed: () => _openProgress(run),
          icon: const Icon(Icons.info_outline, size: 16),
          label: const Text('查看'),
        ),
        if (_active(run))
          AppActionButton(
            tooltip: stopping ? '正在终止' : '终止 $agent 的运行',
            onPressed: stopping ? null : () => _cancel(run),
            icon: Icon(
              stopping ? Icons.hourglass_top : Icons.stop_circle,
              color: _aiRed,
            ),
          )
        else if (run['status'] == 'failed' &&
            run['trigger_comment_id'] is String)
          AppActionButton(
            tooltip: '重试 $agent 的运行',
            onPressed: () => _retryRun(run),
            icon: const Icon(Icons.refresh, color: _aiRed),
          ),
      ],
    );
  }

  String _statusLabel(String status) => switch (status) {
    'queued' => '排队中',
    'dispatched' => '等待 Agent',
    'waiting_local_directory' => '等待本地目录',
    'deferred' => '等待处理',
    'running' => '正在处理',
    _ => '处理中',
  };

  Widget _renderContent(String content, Color textColor) {
    final style = imindMarkdownStyle(
      context,
      textColor: textColor,
      bodyFontSize: 15,
      bodyHeight: 1.55,
    );
    final parts = _splitDocFences(content);
    if (parts.length == 1 && parts.single is String) {
      return MarkdownBody(data: content, styleSheet: style);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final part in parts)
          if (part is String)
            MarkdownBody(data: part, styleSheet: style)
          else
            _docCard(part as _DocNote),
      ],
    );
  }

  Widget _docCard(_DocNote note) => InkWell(
    onTap: () => _openDoc(note),
    borderRadius: BorderRadius.circular(10),
    child: Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE2E2E7)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            note.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          if (note.summary.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text(
                note.summary,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: _aiMuted, fontSize: 12),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              children: [
                const Icon(Icons.menu_book, size: 14, color: _aiMuted),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    note.path,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: _aiMuted, fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  Widget _pendingBubble(_PendingMessage message) => Align(
    alignment: Alignment.centerRight,
    child: Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF23262C),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(child: _selectableMessage(message.text, Colors.white)),
          const SizedBox(width: 8),
          if (message.sending)
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
              ),
            )
          else
            AppActionButton(
              tooltip: '重试',
              onPressed: () => _send(message),
              icon: const Icon(Icons.refresh),
            ),
          if (message.error != null)
            Tooltip(
              message: message.error!,
              child: const Icon(
                Icons.error_outline,
                color: Colors.orangeAccent,
                size: 18,
              ),
            ),
        ],
      ),
    ),
  );
}

class _MessageTapTarget extends StatefulWidget {
  const _MessageTapTarget({required this.child, required this.onDoubleTap});
  final Widget child;
  final VoidCallback onDoubleTap;

  @override
  State<_MessageTapTarget> createState() => _MessageTapTargetState();
}

class _MessageTapTargetState extends State<_MessageTapTarget> {
  PointerDownEvent? _down;
  PointerUpEvent? _lastTap;

  @override
  Widget build(BuildContext context) => Listener(
    // SelectionArea's double-tap recognizer otherwise wins the gesture arena.
    onPointerDown: (event) => _down = event,
    onPointerMove: (event) {
      if (_down != null &&
          (event.position - _down!.position).distance > kTouchSlop) {
        _down = null;
        _lastTap = null;
      }
    },
    onPointerCancel: (_) {
      _down = null;
      _lastTap = null;
    },
    onPointerUp: (event) {
      final down = _down;
      final last = _lastTap;
      _down = null;
      if (down == null ||
          event.timeStamp - down.timeStamp >= kLongPressTimeout) {
        _lastTap = null;
        return;
      }
      if (last != null &&
          event.timeStamp - last.timeStamp <= kDoubleTapTimeout &&
          (event.position - last.position).distance <= kDoubleTapSlop) {
        _lastTap = null;
        widget.onDoubleTap();
      } else {
        _lastTap = event;
      }
    },
    child: widget.child,
  );
}

class _DocNote {
  const _DocNote(this.name, this.summary, this.path);
  final String name;
  final String summary;
  final String path;
}

List<Object> _splitDocFences(String content) {
  final result = <Object>[];
  final expression = RegExp(r'```(?:docs|obsidian)[^\n]*\r?\n([\s\S]*?)```');
  var offset = 0;
  for (final match in expression.allMatches(content)) {
    final parsed = _parseDocNote(match.group(1) ?? '');
    if (parsed == null) continue;
    if (match.start > offset) {
      result.add(content.substring(offset, match.start));
    }
    result.add(parsed);
    offset = match.end;
  }
  if (offset < content.length) result.add(content.substring(offset));
  return result.isEmpty ? [content] : result;
}

_DocNote? _parseDocNote(String raw) {
  try {
    final value = jsonDecode(raw);
    if (value is! Map<String, dynamic>) return null;
    final path = value['path'] is String
        ? (value['path'] as String).trim()
        : '';
    if (!path.toLowerCase().endsWith('.md') ||
        path.startsWith('/') ||
        path.contains('\\') ||
        RegExp(r'^[a-z]:', caseSensitive: false).hasMatch(path) ||
        path
            .split('/')
            .any((part) => part.isEmpty || part == '.' || part == '..')) {
      return null;
    }
    final last = path.split('/').last;
    final fallbackName = last.toLowerCase().endsWith('.md')
        ? last.substring(0, last.length - 3)
        : last;
    final name =
        value['name'] is String && (value['name'] as String).trim().isNotEmpty
        ? (value['name'] as String).trim()
        : fallbackName;
    final summary = value['summary'] is String
        ? (value['summary'] as String).replaceAll(RegExp(r'\s+'), ' ').trim()
        : '';
    return _DocNote(name, summary, path);
  } catch (_) {
    return null;
  }
}
