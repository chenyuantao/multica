import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';

abstract interface class SessionStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class SecureSessionStorage implements SessionStorage {
  const SecureSessionStorage();
  static const _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class SessionData {
  const SessionData({
    required this.baseUrl,
    required this.token,
    this.workspaceId,
    this.machine,
  });
  final String baseUrl;
  final String token;
  final String? workspaceId;
  final String? machine;

  Map<String, dynamic> toJson() => {
    'base_url': baseUrl,
    'token': token,
    'workspace_id': workspaceId,
    'share_machine': machine,
  };
}

class SessionStore {
  SessionStore({SessionStorage? storage})
    : _storage = storage ?? const SecureSessionStorage();
  static const sessionKey = 'imind_session';
  static const _legacyKeys = [
    'multica_token',
    'imind_workspace_id',
    'imind_share_machine',
  ];
  final SessionStorage _storage;
  Future<void> _pending = Future<void>.value();

  Future<void> _enqueue(Future<void> Function() operation) {
    final next = _pending.then((_) => operation());
    _pending = next.catchError((Object _) {});
    return next;
  }

  Future<SessionData?> read(String baseUrl) async {
    await _pending;
    final String? raw;
    try {
      raw = await _storage.read(sessionKey);
    } catch (_) {
      throw ApiException(0, '无法读取登录信息，请重新登录');
    }
    if (raw == null) {
      await clear();
      return null;
    }
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      decoded = null;
    }
    if (decoded is! Map<String, dynamic> ||
        decoded['base_url'] != baseUrl ||
        !validSessionToken(decoded['token']) ||
        (decoded['workspace_id'] != null &&
            !validWorkspaceId(decoded['workspace_id'])) ||
        (decoded['share_machine'] != null &&
            (decoded['workspace_id'] == null ||
                !validShareMachine(decoded['share_machine'])))) {
      await clear();
      return null;
    }
    return SessionData(
      baseUrl: baseUrl,
      token: decoded['token'] as String,
      workspaceId: decoded['workspace_id'] as String?,
      machine: decoded['share_machine'] as String?,
    );
  }

  Future<void> save(SessionData data) => _enqueue(() async {
    try {
      await _storage.write(sessionKey, jsonEncode(data.toJson()));
    } catch (_) {
      throw ApiException(0, '无法保存登录信息，请重试');
    }
  });

  Future<void> clear() => _enqueue(() async {
    var failed = false;
    for (final key in [sessionKey, ..._legacyKeys]) {
      try {
        await _storage.delete(key);
      } catch (_) {
        failed = true;
      }
    }
    if (failed) throw ApiException(0, '无法清除设备上的登录信息，请重试');
  });
}

class SessionController extends ChangeNotifier {
  SessionController({required this.api, SessionStore? store})
    : store = store ?? SessionStore() {
    api.onUnauthorized = logout;
  }
  final MulticaApi api;
  final SessionStore store;
  SessionData? data;
  String? error;
  bool ready = false;
  int _generation = 0;
  bool _disposed = false;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> restore({String? initialToken}) async {
    final generation = _generation;
    SessionData? restored;
    String? restoreError;
    try {
      if (initialToken != null) {
        if (validSessionToken(initialToken)) {
          restored = SessionData(baseUrl: api.baseUrl, token: initialToken);
        }
      } else {
        restored = await store.read(api.baseUrl);
      }
    } on ApiException catch (failure) {
      restoreError = failure.message;
    }
    if (generation != _generation || _disposed) return;
    error = restoreError;
    data = restored;
    api.clearSession();
    api.token = restored?.token;
    api.workspaceId = restored?.workspaceId;
    ready = true;
    _notify();
  }

  Future<void> login(String token) async {
    if (!validSessionToken(token)) throw ApiException(502, '登录没有返回有效凭证');
    final generation = ++_generation;
    final next = SessionData(baseUrl: api.baseUrl, token: token);
    try {
      await store.clear();
      if (generation != _generation || _disposed) return;
      await store.save(next);
    } on ApiException {
      if (generation == _generation && !_disposed) await logout();
      rethrow;
    }
    if (generation != _generation || _disposed) return;
    data = next;
    api.clearSession();
    api.token = token;
    error = null;
    _notify();
  }

  Future<void> select(String? workspaceId, String? machine) async {
    final current = data;
    if (current == null || api.token != current.token) {
      throw ApiException(401, '请先登录');
    }
    if ((workspaceId != null && !validWorkspaceId(workspaceId)) ||
        (machine != null &&
            (workspaceId == null || !validShareMachine(machine)))) {
      throw ApiException(400, '工作区或共享知识库标识无效');
    }
    if (current.workspaceId == workspaceId && current.machine == machine) {
      return;
    }
    final generation = _generation;
    final next = SessionData(
      baseUrl: current.baseUrl,
      token: current.token,
      workspaceId: workspaceId,
      machine: machine,
    );
    await store.save(next);
    if (generation != _generation || _disposed) {
      throw ApiException(401, '登录状态已变更，请重新登录');
    }
    data = next;
    api.workspaceId = workspaceId;
    _notify();
  }

  Future<void> logout() async {
    final generation = ++_generation;
    api.clearSession();
    data = null;
    error = null;
    ready = true;
    _notify();
    try {
      await store.clear();
    } on ApiException catch (failure) {
      if (generation == _generation && !_disposed) {
        error = failure.message;
        _notify();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    api.onUnauthorized = null;
    api.clearSession();
    super.dispose();
  }
}
