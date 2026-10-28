import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:http/http.dart' as http;

const _apiBaseOverride = String.fromEnvironment('API_BASE');

String defaultApiBase() {
  if (_apiBaseOverride.isNotEmpty) return _apiBaseOverride;
  if (Platform.isAndroid) return 'http://10.0.2.2:18607';
  return 'http://127.0.0.1:18607';
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
  }) : baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), ''),
       _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;
  final Duration requestTimeout;
  Future<void> Function()? onUnauthorized;
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

  Future<Object?> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool auth = true,
    bool workspace = true,
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
      })().timeout(requestTimeout);
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
