import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/offline_cache.dart';
import 'package:imind_app/session.dart';

class MemoryStorage implements SessionStorage {
  final values = <String, String>{};
  Completer<String?>? delayedRead;
  @override
  Future<String?> read(String key) async => delayedRead?.future ?? values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

void main() {
  late MulticaApi api;
  late MemoryStorage storage;
  late OfflineCache cache;
  late OfflineCacheScope scope;
  late OfflineResource<String> resource;
  setUp(() {
    api = MulticaApi(baseUrl: 'https://example.com')
      ..token = 'private-token'
      ..workspaceId = 'workspace';
    storage = MemoryStorage();
    cache = OfflineCache(storage: storage);
    scope = OfflineCacheScope.capture(api, machine: 'root');
    resource = OfflineResource<String>(
      scope: scope,
      key: 'note',
      decode: (value) => value as String,
      cache: cache,
    );
  });
  tearDown(() {
    resource.dispose();
    api.close();
  });

  test('cache renders first, network replaces it and persists', () async {
    await cache.write(scope, 'note', 'cached');
    final network = Completer<String>();
    final seen = <String>[];
    final load = resource.load(
      network: () => network.future,
      onData: (value, cached) => seen.add('$value:$cached'),
    );
    await Future<void>.delayed(Duration.zero);
    expect(seen, ['cached:true']);
    expect(resource.networkReady, isFalse);
    network.complete('fresh');
    await load;
    await Future<void>.delayed(Duration.zero);
    expect(seen, ['cached:true', 'fresh:false']);
    expect(resource.networkReady, isTrue);
    expect(await cache.read(scope, 'note'), 'fresh');
  });

  test('late cache never overwrites a successful network result', () async {
    storage.delayedRead = Completer<String?>();
    final seen = <String>[];
    await resource.load(
      network: () async => 'fresh',
      onData: (value, _) => seen.add(value),
    );
    storage.delayedRead!.complete('"old"');
    await Future<void>.delayed(Duration.zero);
    expect(seen, ['fresh']);
  });

  test(
    'network failure retains offline data and keeps mutations locked',
    () async {
      await cache.write(scope, 'note', 'cached');
      final seen = <String>[];
      Object? failure;
      await resource.load(
        network: () async => throw StateError('offline'),
        onData: (value, _) => seen.add(value),
        onError: (error) => failure = error,
      );
      await Future<void>.delayed(Duration.zero);
      expect(seen, ['cached']);
      expect(failure, isStateError);
      expect(resource.networkReady, isFalse);
    },
  );

  test(
    'superseded network response cannot render or poison persistent cache',
    () async {
      final first = Completer<String>();
      final seen = <String>[];
      final load = resource.load(
        network: () => first.future,
        onData: (value, _) => seen.add(value),
      );
      await resource.load(
        network: () async => 'new',
        onData: (value, _) => seen.add(value),
      );
      first.complete('stale');
      await load;
      await Future<void>.delayed(Duration.zero);
      expect(seen, ['new']);
      expect(await cache.read(scope, 'note'), 'new');
    },
  );

  test(
    'server, account, workspace and machine partition encrypted storage keys',
    () async {
      await cache.write(scope, 'note', 'private');
      expect(storage.values.keys.single.contains('private-token'), isFalse);
      final other = MulticaApi(baseUrl: api.baseUrl)
        ..token = 'other-token'
        ..workspaceId = api.workspaceId;
      expect(
        await cache.read(
          OfflineCacheScope.capture(other, machine: 'root'),
          'note',
        ),
        isNull,
      );
      other.token = api.token;
      other.workspaceId = 'other-workspace';
      expect(
        await cache.read(
          OfflineCacheScope.capture(other, machine: 'root'),
          'note',
        ),
        isNull,
      );
      expect(
        await cache.read(
          OfflineCacheScope.capture(api, machine: 'other-root'),
          'note',
        ),
        isNull,
      );
      other.close();
      final otherServer = MulticaApi(baseUrl: 'https://other.example.com')
        ..token = api.token
        ..workspaceId = api.workspaceId;
      expect(
        await cache.read(
          OfflineCacheScope.capture(otherServer, machine: 'root'),
          'note',
        ),
        isNull,
      );
      otherServer.close();
    },
  );

  test('disposing from a network callback prevents cache writes', () async {
    await resource.load(
      network: () async => 'old-account',
      onData: (_, _) {
        resource.dispose();
      },
    );
    await Future<void>.delayed(Duration.zero);
    expect(await cache.read(scope, 'note'), isNull);
  });

  test(
    'queued writes keep arrival order and snapshot mutable payloads',
    () async {
      final payload = <String, dynamic>{'content': 'first'};
      final firstWrite = cache.write(scope, 'note', payload);
      payload['content'] = 'changed after write';
      await firstWrite;
      expect(await cache.read(scope, 'note'), {'content': 'first'});
      final olderWrite = cache.write(scope, 'note', 'older');
      final newerWrite = cache.write(scope, 'note', 'newer');
      await Future.wait([olderWrite, newerWrite]);
      expect(await cache.read(scope, 'note'), 'newer');
    },
  );

  testWidgets('shared mutation interceptor displays a toast until confirmed', (
    tester,
  ) async {
    var actions = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => IconButton(
              tooltip: '发送',
              icon: const Icon(Icons.send),
              onPressed: () {
                if (resource.allowAction(context)) actions++;
              },
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('发送'));
    await tester.pump();
    expect(actions, 0);
    expect(find.text('正在同步，请联网后重试'), findsOneWidget);
    await resource.load(network: () async => 'fresh', onData: (_, _) {});
    await tester.tap(find.byTooltip('发送'));
    expect(actions, 1);
  });
}
