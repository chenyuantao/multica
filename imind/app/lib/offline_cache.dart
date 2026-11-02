import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';

import 'api.dart';
import 'session.dart';

/// Captures the identity of a request, including its account and shared root.
class OfflineCacheScope {
  OfflineCacheScope.capture(MulticaApi api, {this.machine})
    : baseUrl = api.baseUrl,
      _token = api.token,
      workspaceId = api.workspaceId;

  final String baseUrl;
  final String? _token, workspaceId, machine;

  String get storageKey => sha256
      .convert(utf8.encode(jsonEncode([baseUrl, _token, workspaceId, machine])))
      .toString();

  bool matches(MulticaApi api, {String? machine}) =>
      baseUrl == api.baseUrl &&
      _token == api.token &&
      workspaceId == api.workspaceId &&
      this.machine == machine;
}

/// Cached payloads use the same encrypted platform storage as login sessions.
class OfflineCache {
  OfflineCache({SessionStorage? storage})
    : _storage = storage ?? const SecureSessionStorage();

  static OfflineCache instance = OfflineCache();
  final SessionStorage _storage;
  final _writes = <String, Future<void>>{};

  String _key(OfflineCacheScope scope, String key) =>
      'imind_cache_v1_${scope.storageKey}_${sha256.convert(utf8.encode(key))}';

  Future<Object?> read(OfflineCacheScope scope, String key) async {
    try {
      final raw = await _storage.read(_key(scope, key));
      return raw == null ? null : jsonDecode(raw);
    } catch (_) {
      return null;
    }
  }

  Future<void> write(OfflineCacheScope scope, String key, Object? value) async {
    final storageKey = _key(scope, key);
    final String encoded;
    try {
      encoded = jsonEncode(value);
    } catch (_) {
      return;
    }
    final previous = _writes[storageKey] ?? Future<void>.value();
    final next = previous.then((_) async {
      try {
        await _storage.write(storageKey, encoded);
      } catch (_) {
        // A cache failure must not turn a successful network read into an error.
      }
    });
    _writes[storageKey] = next;
    await next;
    if (identical(_writes[storageKey], next)) _writes.remove(storageKey);
  }
}

/// A cached read may render first, but only a successful network read unlocks
/// mutations. Every new load supersedes previous reads, including cache writes.
class OfflineResource<T> {
  OfflineResource({
    required this.scope,
    required this.key,
    required this.decode,
    OfflineCache? cache,
  }) : _cache = cache ?? OfflineCache.instance;

  final OfflineCacheScope scope;
  final String key;
  final T Function(Object?) decode;
  final OfflineCache _cache;
  int _generation = 0;
  bool _disposed = false;
  bool networkReady = false;

  Future<void> load({
    required Future<T> Function() network,
    required void Function(T value, bool fromCache) onData,
    void Function(Object error)? onError,
  }) async {
    final generation = ++_generation;
    networkReady = false;
    var networkSucceeded = false;
    bool active() => !_disposed && generation == _generation;
    unawaited(() async {
      final cached = await _cache.read(scope, key);
      if (cached == null || !active() || networkSucceeded) return;
      try {
        final value = decode(cached);
        if (active() && !networkSucceeded) onData(value, true);
      } catch (_) {
        // Corrupt or incompatible cache entries are ignored.
      }
    }());
    try {
      final value = await network();
      if (!active()) return;
      networkSucceeded = true;
      networkReady = true;
      onData(value, false);
      if (active()) unawaited(_cache.write(scope, key, value));
    } catch (error) {
      if (active()) {
        networkReady = false;
        onError?.call(error);
      }
    }
  }

  Future<void> updateCache(T value) async {
    if (_disposed || !networkReady) return;
    await _cache.write(scope, key, value);
  }

  bool allowAction(BuildContext context) =>
      allowNetworkAction(context, networkReady);

  void dispose() {
    _disposed = true;
    networkReady = false;
    _generation++;
  }
}

bool allowNetworkAction(BuildContext context, bool networkReady) {
  if (networkReady) return true;
  ScaffoldMessenger.maybeOf(context)
    ?..hideCurrentSnackBar()
    ..showSnackBar(
      const SnackBar(
        content: Text('正在同步，请联网后重试'),
        behavior: SnackBarBehavior.floating,
        margin: EdgeInsets.fromLTRB(16, 0, 16, 96),
        duration: Duration(seconds: 2),
      ),
    );
  return false;
}
