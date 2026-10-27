import 'dart:convert';
import 'dart:io' show Platform;

import 'package:http/http.dart' as http;

const _apiBaseOverride = String.fromEnvironment('API_BASE');

/// Android 模拟器里的 127.0.0.1 是模拟器自己，宿主机 API 要走 10.0.2.2。
String defaultApiBase() {
  if (_apiBaseOverride.isNotEmpty) return _apiBaseOverride;
  if (Platform.isAndroid) return 'http://10.0.2.2:18607';
  return 'http://127.0.0.1:18607';
}

class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => message;
}

class MulticaApi {
  MulticaApi({required this.baseUrl, http.Client? client})
    : _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;
  String? token;

  Future<void> sendCode(String email) =>
      _post('/auth/send-code', {'email': email}, auth: false);

  Future<String> verifyCode(String email, String code) async {
    final body = await _post('/auth/verify-code', {
      'email': email,
      'code': code,
    }, auth: false);
    final value = body['token'];
    if (value is! String || value.isEmpty) throw ApiException(500, '登录没有返回凭证');
    token = value;
    return value;
  }

  Future<List<Map<String, dynamic>>> shares() async {
    final body = await _get('/api/imind/shares');
    return ((body['shares'] as List?) ?? const []).cast<Map<String, dynamic>>();
  }

  Future<void> bootstrap(String machine) =>
      _post('/api/imind/bootstrap', {'share_machine': machine});

  Future<List<Map<String, dynamic>>> notes(
    String machine, {
    String? tag,
  }) async {
    final body = await _post('/api/imind/notes/list', {
      'share_machine': machine,
      if (tag != null && tag.isNotEmpty) 'tag': tag,
    });
    return ((body['notes'] as List?) ?? const []).cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> createNote(Map<String, dynamic> note) =>
      _post('/api/imind/notes', note);

  Future<Map<String, dynamic>> getNote(String machine, String id) =>
      _post('/api/imind/notes/get', {'share_machine': machine, 'id': id});

  Future<Map<String, dynamic>> updateNote(
    String id,
    Map<String, dynamic> note,
  ) => _put('/api/imind/notes/$id', note);

  Future<void> deleteNote(String id, String machine, String revision) async {
    final response = await _client.delete(
      _uri('/api/imind/notes/$id'),
      headers: _headers(),
      body: jsonEncode({'share_machine': machine, 'revision': revision}),
    );
    _decode(response);
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final response = await _client.get(_uri(path), headers: _headers());
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body, {
    bool auth = true,
  }) async {
    final response = await _client.post(
      _uri(path),
      headers: _headers(auth: auth),
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> _put(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await _client.put(
      _uri(path),
      headers: _headers(),
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Map<String, String> _headers({bool auth = true}) => {
    'Content-Type': 'application/json',
    if (auth && token != null) 'Authorization': 'Bearer $token',
  };

  Map<String, dynamic> _decode(http.Response response) {
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body);
    if (response.statusCode >= 400) {
      final message = decoded is Map && decoded['error'] is String
          ? decoded['error'] as String
          : '请求失败';
      throw ApiException(response.statusCode, message);
    }
    return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
  }
}
