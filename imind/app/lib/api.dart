import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

const _apiBaseOverride = String.fromEnvironment('API_BASE');

String defaultApiBase() {
  if (_apiBaseOverride.isNotEmpty) return _apiBaseOverride;
  return 'https://chat.preview.aliyun-zeabur.cn';
}

bool validWorkspaceId(Object? value) =>
    value is String &&
    RegExp(r'^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$')
        .hasMatch(value);

bool validShareMachine(Object? value) =>
    value is String &&
    value.trim().isNotEmpty &&
    value == value.trim() &&
    value != '.' &&
    value != '..' &&
    !RegExp(r'[/\\\x00-\x1f\x7f]').hasMatch(value);

bool validSessionToken(Object? value) =>
    value is String &&
    value.isNotEmpty &&
    !RegExp(r'\s|[\x00-\x1f\x7f]').hasMatch(value);

class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => message;
}

class MulticaApi {
  MulticaApi({
    required String baseUrl,
    http.Client? client,
    this.requestTimeout = const Duration(seconds: 20),
    this.onUnauthorized,
    this.enableRealtime = true,
  }) : baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), ''),
       _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;
  final Duration requestTimeout;
  Future<void> Function()? onUnauthorized;
  final bool enableRealtime;
  String? token;
  String? workspaceId;
  int _sessionVersion = 0;

  void clearSession() {
    token = null;
    workspaceId = null;
    _sessionVersion++;
  }

  void close() => _client.close();

  Future<void> sendCode(String email) async {
    await _request(
      'POST',
      '/auth/send-code',
      body: {'email': email},
      auth: false,
    );
  }

  Future<String> verifyCode(String email, String code) async {
    final body = _object(
      await _request(
        'POST',
        '/auth/verify-code',
        body: {'email': email, 'code': code},
        auth: false,
      ),
    );
    final value = body['token'];
    if (!validSessionToken(value)) throw ApiException(502, '登录没有返回有效凭证');
    clearSession();
    token = value as String;
    return token!;
  }

  Future<List<Map<String, dynamic>>> workspaces() async {
    final body = await _request('GET', '/api/workspaces', workspace: false);
    if (body is! List) throw _malformed('workspaces');
    return [for (final value in body) _workspace(value)];
  }

  Future<Map<String, dynamic>> getMe() async {
    final data = _object(await _request('GET', '/api/me', workspace: false));
    if (!_validId(data['id'])) throw _malformed('me.id');
    return data;
  }

  Future<List<Map<String, dynamic>>> workspaceAgents() async {
    final workspace = workspaceId;
    if (!validWorkspaceId(workspace)) throw ApiException(400, '请先选择工作区');
    final value = await _request(
      'GET',
      '/api/agents?${Uri(queryParameters: {'workspace_id': workspace!}).query}',
    );
    if (value is! List) throw _malformed('agents');
    return [for (final item in value) _object(item)];
  }

  Future<List<Map<String, dynamic>>> shares() async {
    final body = _object(await _request('GET', '/api/imind/shares'));
    return [for (final value in _list(body['shares'], 'shares')) _share(value)];
  }

  Future<void> bootstrap(String machine) async {
    _checkMachine(machine);
    _object(
      await _request(
        'POST',
        '/api/imind/bootstrap',
        body: {'share_machine': machine},
      ),
    );
  }

  Future<List<Map<String, dynamic>>> notes(
    String machine, {
    String? tag,
  }) async {
    _checkMachine(machine);
    final body = _object(
      await _request(
        'POST',
        '/api/imind/notes/list',
        body: {
          'share_machine': machine,
          if (tag != null && tag.isNotEmpty) 'tag': tag,
        },
      ),
    );
    return [for (final value in _list(body['notes'], 'notes')) _note(value)];
  }

  Future<Map<String, dynamic>> createNote(Map<String, dynamic> note) async {
    _checkMachine(note['share_machine']);
    return _note(await _request('POST', '/api/imind/notes', body: note));
  }

  Future<Map<String, dynamic>> getNote(String machine, String id) async {
    _checkMachine(machine);
    _checkId(id);
    return _note(
      await _request(
        'POST',
        '/api/imind/notes/get',
        body: {'share_machine': machine, 'id': id},
      ),
      expectedId: id,
    );
  }

  Future<Map<String, dynamic>> updateNote(
    String id,
    Map<String, dynamic> note,
  ) async {
    _checkId(id);
    _checkMachine(note['share_machine']);
    _requiredString(note, 'revision', status: 400);
    return _note(
      await _request('PUT', '/api/imind/notes/$id', body: note),
      expectedId: id,
    );
  }

  Future<Map<String, dynamic>> nameNote(
    String machine,
    String id,
    String revision,
  ) async {
    _checkMachine(machine);
    _checkId(id);
    return _note(
      await _request(
        'POST',
        '/api/imind/notes/$id/ai-name',
        timeout: const Duration(seconds: 55),
        body: {'share_machine': machine, 'revision': revision},
      ),
      expectedId: id,
    );
  }

  Future<Map<String, dynamic>> tagNote(
    String machine,
    String id, {
    required String revision,
  }) async {
    _checkMachine(machine);
    _checkId(id);
    _requiredString({'revision': revision}, 'revision', status: 400);
    return _note(
      await _request(
        'POST',
        '/api/imind/notes/$id/ai-tag',
        timeout: const Duration(seconds: 55),
        body: {'share_machine': machine, 'revision': revision},
      ),
      expectedId: id,
    );
  }

  Future<void> deleteNote(String id, String machine, String revision) async {
    _checkId(id);
    _checkMachine(machine);
    _requiredString({'revision': revision}, 'revision', status: 400);
    _object(
      await _request(
        'DELETE',
        '/api/imind/notes/$id',
        body: {'share_machine': machine, 'revision': revision},
      ),
    );
  }

  Future<void> uploadMedia({
    required String machine,
    required String noteId,
    required String name,
    required String contentType,
    required Uint8List bytes,
  }) async {
    _checkMachine(machine);
    _checkId(noteId);
    if (name != 'audio.wav' &&
        !RegExp(
          r'^[A-Za-z0-9-]{16,}\.(?:jpe?g|png|webp)$',
          caseSensitive: false,
        ).hasMatch(name)) {
      throw ApiException(400, '媒体文件名无效');
    }
    final uri = Uri.parse('$baseUrl/api/imind/media').replace(
      queryParameters: {'share_machine': machine, 'id': noteId, 'name': name},
    );
    final request = http.Request('POST', uri)
      ..followRedirects = false
      ..headers['Content-Type'] = contentType
      ..bodyBytes = bytes;
    await _sendMediaRequest(request);
  }

  Future<List<int>> getMedia({
    required String machine,
    required String noteId,
    required String name,
  }) async {
    _checkMachine(machine);
    _checkId(noteId);
    if (name != 'audio.wav' &&
        !RegExp(
          r'^[A-Za-z0-9-]{16,}\.(?:jpe?g|png|webp)$',
          caseSensitive: false,
        ).hasMatch(name)) {
      throw ApiException(400, '媒体文件名无效');
    }
    final uri = Uri.parse(
      '$baseUrl/api/imind/media/$noteId/${Uri.encodeComponent(name)}',
    ).replace(queryParameters: {'share_machine': machine});
    final request = http.Request('GET', uri)..followRedirects = false;
    final response = await _sendMediaRequest(request);
    if (response.statusCode != 200) {
      throw ApiException(response.statusCode, '媒体读取失败');
    }
    return response.bodyBytes;
  }

  Future<http.Response> _sendMediaRequest(http.Request request) async {
    final requestToken = token;
    final requestWorkspaceId = workspaceId;
    final version = _sessionVersion;
    if (!validSessionToken(requestToken)) {
      throw ApiException(401, '请先登录');
    }
    if (!validWorkspaceId(requestWorkspaceId)) {
      throw ApiException(400, '请先选择工作区');
    }
    request.headers.addAll({
      'Authorization': 'Bearer $requestToken',
      'X-Workspace-ID': requestWorkspaceId!,
    });
    final http.Response response;
    try {
      final streamed = await _client.send(request).timeout(requestTimeout);
      response = await http.Response.fromStream(streamed)
          .timeout(requestTimeout);
    } on TimeoutException {
      throw ApiException(408, '请求超时，请重试');
    } on Exception {
      throw ApiException(0, '无法连接服务器，请重试');
    }
    if (response.statusCode == 401) {
      if (token == requestToken && version == _sessionVersion) {
        clearSession();
        await onUnauthorized?.call();
      }
      throw ApiException(401, '登录已过期，请重新登录');
    }
    if (token != requestToken || version != _sessionVersion) {
      throw ApiException(401, '登录状态已变更，请重新登录');
    }
    if (workspaceId != requestWorkspaceId) {
      throw ApiException(409, '工作区已变更，请重新加载');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      var message = '媒体请求失败';
      try {
        final data = jsonDecode(response.body);
        if (data is Map &&
            data['error'] is String &&
            (data['error'] as String).trim().isNotEmpty) {
          message = (data['error'] as String).replaceAll(
            requestToken!,
            '[已隐藏]',
          );
        }
      } on FormatException {
        // Keep the generic message for non-JSON errors.
      }
      throw ApiException(response.statusCode, message);
    }
    return response;
  }

  Future<Map<String, dynamic>> ensureNoteChat(
    String machine,
    String noteId, {
    required String revision,
  }) async {
    _checkMachine(machine);
    _checkId(noteId);
    final data = _object(
      await _request(
        'POST',
        '/api/imind/chats/ensure',
        body: {
          'share_machine': machine,
          'note_id': noteId,
          'revision': _requiredString({'revision': revision}, 'revision'),
        },
      ),
    );
    final issueId = _requiredString(data, 'issue_id');
    if (!validWorkspaceId(issueId)) throw _malformed('chat.issue_id');
    return {
      'issue_id': issueId,
      'identifier': _string(data, 'identifier'),
      'title': _string(data, 'title', 'iMind 群聊'),
      'joined': data['joined'] == true,
    };
  }

  Future<List<Map<String, dynamic>>> noteChatUnread() async {
    final data = _object(await _request('GET', '/api/imind/chats/unread'));
    return [
      for (final value in _list(data['chats'], 'chats'))
        _noteChatUnreadRow(value),
    ];
  }

  Map<String, dynamic> _noteChatUnreadRow(Object? value) {
    final row = _object(value);
    final noteId = _requiredString(row, 'note_id');
    final issueId = _requiredString(row, 'issue_id');
    final machine = _requiredString(row, 'share_machine');
    final unread = row['unread_count'];
    if (!validShareMachine(machine) ||
        !validWorkspaceId(noteId) ||
        !validWorkspaceId(issueId) ||
        unread is! int ||
        unread < 0) {
      throw _malformed('chat unread');
    }
    return {
      'note_id': noteId,
      'share_machine': machine,
      'issue_id': issueId,
      'title': _string(row, 'title', 'AI+ 群聊'),
      'unread_count': unread,
    };
  }

  Future<void> markNoteChatRead(String issueId) async {
    _checkId(issueId);
    await _request('POST', '/api/group-chats/$issueId/read');
  }

  Future<Map<String, dynamic>> noteChatHistory(
    String issueId, {
    String? beforeCreatedAt,
    String? beforeId,
    int limit = 50,
  }) async {
    _checkId(issueId);
    final query = <String, String>{'limit': '${limit.clamp(1, 200)}'};
    if (beforeCreatedAt != null && beforeId != null) {
      query['before_created_at'] = beforeCreatedAt;
      query['before_id'] = beforeId;
    }
    final path =
        '/api/issues/$issueId/comments/page?${Uri(queryParameters: query).query}';
    final data = _object(await _request('GET', path));
    final comments = <Map<String, dynamic>>[];
    for (final value in _list(data['comments'], 'comments')) {
      final comment = _object(value);
      if (_string(comment, 'issue_id') != issueId) continue;
      if (!_validId(comment['id'])) throw _malformed('comment.id');
      comments.add(comment);
    }
    return {
      'comments': comments,
      'has_more': data['has_more'] == true,
      'next_cursor': data['next_cursor'],
    };
  }

  Future<Map<String, dynamic>> sendNoteChatMessage(
    String issueId,
    String content, {
    required String clientId,
  }) async {
    _checkId(issueId);
    _checkId(clientId);
    if (content.trim().isEmpty) throw ApiException(400, '消息不能为空');
    final data = _object(
      await _request(
        'POST',
        '/api/issues/$issueId/comments',
        body: {'content': content, 'type': 'comment', 'client_id': clientId},
      ),
    );
    if (!_validId(data['id']) || data['issue_id'] != issueId) {
      throw _malformed('comment');
    }
    return data;
  }

  Future<List<Map<String, dynamic>>> noteChatRuns(String issueId) async {
    _checkId(issueId);
    final value = await _request('GET', '/api/issues/$issueId/task-runs');
    if (value is! List) throw _malformed('task-runs');
    return [for (final item in value) _object(item)];
  }

  Future<List<Map<String, dynamic>>> noteChatRunMessages(String taskId) async {
    _checkId(taskId);
    final value = await _request('GET', '/api/tasks/$taskId/messages');
    if (value is! List) throw _malformed('task-messages');
    final messages = [for (final item in value) _object(item)];
    for (final message in messages) {
      if (message['task_id'] != taskId || message['seq'] is! num) {
        throw _malformed('task-message');
      }
    }
    messages.sort((a, b) => (a['seq'] as num).compareTo(b['seq'] as num));
    return messages;
  }

  Future<Map<String, dynamic>> cancelNoteChatRun(
    String issueId,
    String taskId,
  ) async {
    _checkId(issueId);
    _checkId(taskId);
    return _object(
      await _request('POST', '/api/issues/$issueId/tasks/$taskId/cancel'),
    );
  }

  Future<void> retryNoteChatRun(
    String issueId,
    String taskId,
    String commentId,
  ) async {
    _checkId(issueId);
    _checkId(taskId);
    _checkId(commentId);
    await _request(
      'POST',
      '/api/issues/$issueId/tasks/$taskId/supplements/$commentId/retry',
    );
  }

  Future<Map<String, dynamic>> retryNoteChatDispatch(
    String issueId,
    String commentId,
  ) async {
    _checkId(issueId);
    _checkId(commentId);
    return _object(
      await _request(
        'POST',
        '/api/imind/chats/$issueId/retry',
        body: {'comment_id': commentId},
      ),
    );
  }

  Future<Map<String, dynamic>> getDocFile(String path) async {
    if (!_validRelativeMarkdownPath(path)) throw ApiException(400, '文档路径无效');
    return _object(
      await _request('POST', '/api/docs/files/content', body: {'path': path}),
    );
  }

  bool _validId(Object? value) => validWorkspaceId(value);

  bool _validRelativeMarkdownPath(String path) =>
      path.toLowerCase().endsWith('.md') &&
      !path.startsWith('/') &&
      !path.contains('\\') &&
      !RegExp(r'^[a-z]:', caseSensitive: false).hasMatch(path) &&
      path
          .split('/')
          .every((part) => part.isNotEmpty && part != '.' && part != '..');

  Future<Object?> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool auth = true,
    bool workspace = true,
    Duration? timeout,
  }) async {
    final requestToken = token;
    final requestWorkspaceId = workspaceId;
    final version = _sessionVersion;
    if (auth && !validSessionToken(requestToken)) {
      throw ApiException(401, '请先登录');
    }
    if (auth && workspace && !validWorkspaceId(workspaceId)) {
      throw ApiException(400, '请先选择工作区');
    }
    final request = http.Request(method, Uri.parse('$baseUrl$path'))
      ..followRedirects = false;
    request.headers.addAll({
      'Content-Type': 'application/json',
      if (auth) 'Authorization': 'Bearer $requestToken',
      if (auth && workspace) 'X-Workspace-ID': workspaceId!,
    });
    if (body != null) request.body = jsonEncode(body);
    final http.Response response;
    try {
      response = await (() async {
        final streamed = await _client.send(request);
        return http.Response.fromStream(streamed);
      })().timeout(timeout ?? requestTimeout);
    } on TimeoutException {
      throw ApiException(408, '请求超时，请重试');
    } on Exception {
      throw ApiException(0, '无法连接服务器，请重试');
    }
    if (auth && response.statusCode == 401) {
      if (token == requestToken && version == _sessionVersion) {
        clearSession();
        await onUnauthorized?.call();
      }
      throw ApiException(401, '登录已过期，请重新登录');
    }
    if (auth && (token != requestToken || version != _sessionVersion)) {
      throw ApiException(401, '登录状态已变更，请重新登录');
    }
    if (auth && workspace && workspaceId != requestWorkspaceId) {
      throw ApiException(409, '工作区已变更，请重新加载');
    }
    Object? decoded;
    try {
      decoded = response.body.isEmpty ? null : jsonDecode(response.body);
    } on FormatException {
      if (response.statusCode < 400) throw _malformed('JSON');
    }
    if (response.statusCode >= 400) {
      final error = decoded is Map ? decoded['error'] : null;
      var message = error is String && error.trim().isNotEmpty ? error : '请求失败';
      for (final secret in [requestToken, if (!auth) body?['code']]) {
        if (secret is String && secret.isNotEmpty) {
          message = message.replaceAll(secret, '[已隐藏]');
        }
      }
      throw ApiException(response.statusCode, message);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(response.statusCode, '服务器返回了意外状态');
    }
    return decoded;
  }

  static ApiException _malformed(String field) =>
      ApiException(502, '服务器返回的数据格式错误：$field');

  static Map<String, dynamic> _object(Object? value) {
    if (value is! Map<String, dynamic>) throw _malformed('object');
    return value;
  }

  static List<dynamic> _list(Object? value, String field) {
    if (value == null) return const [];
    if (value is! List) throw _malformed(field);
    return value;
  }

  static String _requiredString(
    Map<String, dynamic> value,
    String field, {
    int status = 502,
  }) {
    final text = value[field];
    if (text is! String || text.trim().isEmpty || text.contains('\x00')) {
      throw ApiException(
        status,
        status == 502 ? '服务器返回的数据格式错误：$field' : '缺少有效的 $field',
      );
    }
    return text;
  }

  static String _string(
    Map<String, dynamic> value,
    String field, [
    String fallback = '',
  ]) {
    final text = value[field];
    if (text == null) return fallback;
    if (text is! String) throw _malformed(field);
    return text;
  }

  static Map<String, dynamic> _workspace(Object? value) {
    final data = _object(value);
    if (!validWorkspaceId(data['id'])) throw _malformed('workspace.id');
    return {
      'id': data['id'],
      'name': _string(data, 'name', '工作区'),
      'slug': _string(data, 'slug'),
    };
  }

  static Map<String, dynamic> _share(Object? value) {
    final data = _object(value);
    if (!validShareMachine(data['machine'])) throw _malformed('share.machine');
    return {
      'machine': data['machine'],
      'name': _string(data, 'name', data['machine'] as String),
    };
  }

  static Map<String, dynamic> _note(Object? value, {String? expectedId}) {
    final data = _object(value);
    if (!validWorkspaceId(data['id']) ||
        (expectedId != null && data['id'] != expectedId)) {
      throw _malformed('note.id');
    }
    final revision = _requiredString(data, 'revision');
    final type = _string(data, 'type', 'note');
    final tags = <String>[];
    for (final tag in _list(data['tags'], 'note.tags')) {
      if (tag is! String || tag.trim().isEmpty) throw _malformed('note.tags');
      tags.add(tag);
    }
    final source = data['source_url'];
    if (source != null && source is! String) {
      throw _malformed('note.source_url');
    }
    Map<String, dynamic>? audio;
    if (data['audio'] != null) {
      final raw = _object(data['audio']);
      audio = {
        'duration_ms': _nonNegativeInt(raw, 'duration_ms'),
        'sample_rate_hz': _nonNegativeInt(raw, 'sample_rate_hz'),
        'format': _string(raw, 'format'),
        if (raw['file'] is String) 'file': raw['file'],
      };
    }
    return {
      ...data,
      'id': data['id'],
      'revision': revision,
      'type': const ['note', 'recording', 'clip'].contains(type)
          ? type
          : 'note',
      'title': _string(data, 'title', '无标题'),
      'tags': tags,
      'created_at': _string(data, 'created_at'),
      'updated_at': _string(data, 'updated_at'),
      'content': _string(data, 'content'),
      'transcript': _string(data, 'transcript'),
      'source_url': source,
      'summary': _string(data, 'summary'),
      'audio': audio,
      'path': _string(data, 'path'),
    };
  }

  static int _nonNegativeInt(Map<String, dynamic> data, String field) {
    final value = data[field];
    if (value == null) return 0;
    if (value is! int || value < 0) throw _malformed('audio.$field');
    return value;
  }

  static void _checkMachine(Object? machine) {
    if (!validShareMachine(machine)) throw ApiException(400, '共享知识库标识无效');
  }

  static void _checkId(String id) {
    if (!validWorkspaceId(id)) throw ApiException(400, '笔记标识无效');
  }
}
