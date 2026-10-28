import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/session.dart';

const _base = 'http://localhost';
const _workspace = '11111111-1111-4111-8111-111111111111';

class MemorySessionStorage implements SessionStorage {
  final values = <String, String>{};
  final deleted = <String>[];
  bool failRead = false;
  bool failWrite = false;
  String? failDelete;
  Completer<void>? writeBarrier;
  @override
  Future<String?> read(String key) async {
    if (failRead) throw Exception('private storage failure');
    return values[key];
  }

  @override
  Future<void> write(String key, String value) async {
    if (failWrite) throw Exception('private storage failure');
    await writeBarrier?.future;
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    deleted.add(key);
    if (failDelete == key) throw Exception('private storage failure');
    values.remove(key);
  }
}

Map<String, dynamic> _stored({String base = _base}) => {
  'base_url': base,
  'token': 'test-session',
  'workspace_id': _workspace,
  'share_machine': 'mbp',
};

void main() {
  late MemorySessionStorage storage;
  late SessionStore store;
  late MulticaApi api;
  late SessionController session;
  setUp(() {
    storage = MemorySessionStorage();
    store = SessionStore(storage: storage);
    api = MulticaApi(baseUrl: _base);
    session = SessionController(api: api, store: store);
  });
  tearDown(() {
    session.dispose();
    api.close();
  });

  test('安全存储同一条会话包含 token、工作区和共享根', () async {
    await session.restore(initialToken: '');
    await session.login('test-session');
    await session.select(_workspace, 'mbp');
    expect(jsonDecode(storage.values[SessionStore.sessionKey]!), _stored());
    final restored = await store.read(_base);
    expect(restored?.workspaceId, _workspace);
    expect(restored?.machine, 'mbp');
    expect(api.workspaceId, _workspace);
  });
  test('恢复完整会话但不自动访问网络', () async {
    storage.values[SessionStore.sessionKey] = jsonEncode(_stored());
    await session.restore();
    expect(session.ready, isTrue);
    expect(session.data?.machine, 'mbp');
    expect(api.token, isNotNull);
    expect(api.workspaceId, _workspace);
  });
  for (final fields in <Map<String, dynamic>>[
    {'base_url': 'http://another-server'},
    {'token': 7},
    {'token': ''},
    {'workspace_id': 'not-uuid'},
    {'workspace_id': null},
    {'share_machine': '../outside'},
    {'share_machine': 7},
  ]) {
    test('拒绝无效或跨服务根的会话：${fields.keys.single}', () async {
      storage.values[SessionStore.sessionKey] = jsonEncode({
        ..._stored(),
        ...fields,
      });
      await session.restore();
      expect(session.data, isNull);
      expect(api.token, isNull);
      expect(storage.values, isEmpty);
    });
  }
  for (final raw in ['not-json-private-content', '[]', 'null']) {
    test('损坏会话安全清理：${raw == '[]' ? '数组' : '非对象'}', () async {
      storage.values[SessionStore.sessionKey] = raw;
      await session.restore();
      expect(session.data, isNull);
      expect(storage.values, isEmpty);
    });
  }
  test('旧 token 和未绑定工作区的共享根不会被复用', () async {
    storage.values.addAll({
      'multica_token': 'old-test-session',
      'imind_workspace_id': _workspace,
      'imind_share_machine': 'old-mbp',
    });
    await session.restore();
    expect(session.data, isNull);
    expect(storage.values, isEmpty);
  });
  test('退出登录立即清理内存并清理所有已知持久化凭证', () async {
    storage.values[SessionStore.sessionKey] = jsonEncode(_stored());
    storage.values['multica_token'] = 'old-test-session';
    storage.values['imind_share_machine'] = 'old-mbp';
    await session.restore();
    final clearing = session.logout();
    expect(session.data, isNull);
    expect(api.token, isNull);
    expect(api.workspaceId, isNull);
    await clearing;
    expect(storage.values, isEmpty);
    expect(
      storage.deleted,
      containsAll([
        SessionStore.sessionKey,
        'multica_token',
        'imind_workspace_id',
        'imind_share_machine',
      ]),
    );
  });
  test('并发 401 触发持久化清理', () async {
    session.dispose();
    api.close();
    api = MulticaApi(
      baseUrl: _base,
      client: MockClient((_) async => http.Response('not-json', 401)),
    );
    session = SessionController(api: api, store: store);
    storage.values[SessionStore.sessionKey] = jsonEncode(_stored());
    await session.restore();
    await Future.wait([
      expectLater(
        api.shares(),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      ),
      expectLater(
        api.notes('mbp'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      ),
    ]);
    expect(session.data, isNull);
    expect(storage.values, isEmpty);
    expect(
      storage.deleted.where((key) => key == SessionStore.sessionKey),
      hasLength(1),
    );
  });
  test('读失败回到登录并提供明确错误', () async {
    storage.failRead = true;
    await session.restore();
    expect(session.ready, isTrue);
    expect(session.data, isNull);
    expect(session.error, '无法读取登录信息，请重新登录');
  });
  test('登录写失败不进入已认证状态且不保留内存凭证', () async {
    await session.restore(initialToken: '');
    storage.failWrite = true;
    await expectLater(
      session.login('test-session'),
      throwsA(isA<ApiException>()),
    );
    expect(session.data, isNull);
    expect(api.token, isNull);
    expect(storage.values, isEmpty);
  });
  test('某项删除失败仍尝试清理其它凭证并允许重试', () async {
    storage.values[SessionStore.sessionKey] = jsonEncode(_stored());
    storage.values['imind_share_machine'] = 'mbp';
    await session.restore();
    storage.failDelete = SessionStore.sessionKey;
    await session.logout();
    expect(session.data, isNull);
    expect(api.token, isNull);
    expect(session.error, '无法清除设备上的登录信息，请重试');
    expect(storage.values.containsKey('imind_share_machine'), isFalse);
    storage.failDelete = null;
    await session.logout();
    expect(storage.values, isEmpty);
    expect(session.error, isNull);
  });
  test('未完成的选择写入不会在退出登录后恢复凭证', () async {
    await session.restore(initialToken: 'test-session');
    storage.writeBarrier = Completer<void>();
    final selecting = expectLater(
      session.select(_workspace, 'mbp'),
      throwsA(isA<ApiException>()),
    );
    await Future<void>.delayed(Duration.zero);
    final clearing = session.logout();
    storage.writeBarrier!.complete();
    await Future.wait([selecting, clearing]);
    expect(storage.values, isEmpty);
    expect(session.data, isNull);
    expect(api.token, isNull);
  });
  test('无可用工作区时可清理选择但保留账号登录', () async {
    storage.values[SessionStore.sessionKey] = jsonEncode(_stored());
    await session.restore();
    await session.select(null, null);
    expect(session.data?.workspaceId, isNull);
    expect(session.data?.machine, isNull);
    expect(api.token, isNotNull);
    expect(api.workspaceId, isNull);
  });
}
