import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const noteId = '22222222-2222-4222-8222-222222222222';

MulticaApi responding(Object? body, {int status = 200}) =>
    MulticaApi(
        baseUrl: 'http://localhost',
        client: MockClient(
          (_) async => http.Response(
            jsonEncode(body),
            status,
            headers: {'content-type': 'application/json'},
          ),
        ),
      )
      ..token = 'test-session'
      ..workspaceId = workspaceId;

Matcher apiError(int status) =>
    isA<ApiException>().having((e) => e.status, 'status', status);

Future<void> invoke(MulticaApi api, String operation) async =>
    switch (operation) {
      'workspaces' => api.workspaces(),
      'shares' => api.shares(),
      'bootstrap' => api.bootstrap('mbp'),
      'notes' => api.notes('mbp'),
      'create' => api.createNote({'share_machine': 'mbp'}),
      'get' => api.getNote('mbp', noteId),
      'update' => api.updateNote(noteId, {
        'share_machine': 'mbp',
        'revision': 'r',
      }),
      _ => api.deleteNote(noteId, 'mbp', 'r'),
    };
const operations = [
  'workspaces',
  'shares',
  'bootstrap',
  'notes',
  'create',
  'get',
  'update',
  'delete',
];

void main() {
  for (final body in [
    {
      'shares': [null],
    },
    {
      'shares': [
        {'machine': 7},
      ],
    },
    {
      'shares': [
        {'machine': '../outside'},
      ],
    },
    {
      'shares': [
        {'machine': ''},
      ],
    },
    {'shares': 'not a list'},
    [],
    null,
  ]) {
    test('拒绝畸形共享根响应：$body', () async {
      await expectLater(responding(body).shares(), throwsA(apiError(502)));
    });
  }
  for (final body in [
    {},
    {'shares': null, 'notes': null},
  ]) {
    test('可选列表缺省为空：$body', () async {
      expect(await responding(body).shares(), isEmpty);
      expect(await responding(body).notes('mbp'), isEmpty);
    });
  }
  test('共享根显示名缺省', () async {
    expect(
      await responding({
        'shares': [
          {'machine': 'mbp'},
        ],
      }).shares(),
      [
        {'machine': 'mbp', 'name': 'mbp'},
      ],
    );
  });
  test('工作区顶层数组与显示字段缺省', () async {
    expect(
      await responding([
        {'id': workspaceId},
      ]).workspaces(),
      [
        {'id': workspaceId, 'name': '工作区', 'slug': ''},
      ],
    );
    expect(await responding([]).workspaces(), isEmpty);
  });
  for (final body in [
    null,
    {},
    {'workspaces': []},
    [null],
    [
      {'id': 7},
    ],
    [
      {'id': 'bad'},
    ],
  ]) {
    test('拒绝畸形工作区响应：$body', () async {
      await expectLater(responding(body).workspaces(), throwsA(apiError(502)));
    });
  }
  test('全部请求头、URL 和禁止重定向的接线', () async {
    final requests = <http.Request>[];
    final api =
        MulticaApi(
            baseUrl: 'http://localhost/',
            client: MockClient((request) async {
              requests.add(request);
              final path = request.url.path;
              final Object response = path == '/api/workspaces'
                  ? []
                  : path == '/auth/verify-code'
                  ? {'token': 'new-test-session'}
                  : path == '/api/imind/shares'
                  ? {'shares': []}
                  : path == '/api/imind/notes/list'
                  ? {'notes': []}
                  : path.contains('/notes')
                  ? {'id': noteId, 'revision': 'r'}
                  : {};
              return http.Response(jsonEncode(response), 200);
            }),
          )
          ..token = 'test-session'
          ..workspaceId = workspaceId;
    for (final operation in operations) {
      await invoke(api, operation);
    }
    await api.sendCode('example@example.test');
    await api.verifyCode('example@example.test', 'test-code');
    for (final request in requests) {
      expect(request.followRedirects, isFalse);
      expect(request.url.path, isNot(contains('//')));
      if (request.url.path.startsWith('/api/imind')) {
        expect(request.headers['X-Workspace-ID'], workspaceId);
        expect(request.headers['Authorization'], 'Bearer test-session');
      } else {
        expect(request.headers.containsKey('X-Workspace-ID'), isFalse);
        expect(
          request.headers.containsKey('Authorization'),
          !request.url.path.startsWith('/auth'),
        );
      }
    }
    expect(api.workspaceId, isNull);
  });
  test('无工作区或凭证时不发送受保护请求', () async {
    var calls = 0;
    final api = MulticaApi(
      baseUrl: 'http://localhost',
      client: MockClient((_) async {
        calls++;
        return http.Response('{}', 200);
      }),
    );
    await expectLater(api.shares(), throwsA(apiError(401)));
    api.token = 'test-session';
    await expectLater(api.shares(), throwsA(apiError(400)));
    expect(calls, 0);
  });
  test('笔记可选字段缺省与未知类型回退', () async {
    final note = (await responding({
      'notes': [
        {'id': noteId, 'revision': 'r', 'type': 'future-type', 'tags': null},
      ],
    }).notes('mbp')).single;
    expect(note['type'], 'note');
    expect(note['title'], '无标题');
    expect(note['content'], '');
    expect(note['transcript'], '');
    expect(note['updated_at'], '');
    expect(note['tags'], isEmpty);
    expect(note['audio'], isNull);
    expect(note['source_url'], isNull);
    final audio = await responding({'id': noteId, 'revision': 'r', 'audio': {}})
        .getNote('mbp', noteId);
    expect(audio['audio'], {
      'duration_ms': 0,
      'sample_rate_hz': 0,
      'format': '',
    });
  });
  for (final fields in <Map<String, dynamic>>[
    {'id': null},
    {'id': 'bad'},
    {'revision': ''},
    {'revision': 3},
    {'title': 7},
    {'content': []},
    {'transcript': {}},
    {'updated_at': 7},
    {'type': true},
    {'tags': 'tag'},
    {
      'tags': [null],
    },
    {
      'tags': [7],
    },
    {'source_url': []},
    {'audio': []},
    {
      'audio': {'duration_ms': '20'},
    },
    {
      'audio': {'duration_ms': -1},
    },
    {
      'audio': {'duration_ms': 1.5},
    },
    {
      'audio': {'format': 7},
    },
    {
      'audio': {'sample_rate_hz': false},
    },
  ]) {
    test('拒绝笔记畸形字段：$fields', () async {
      await expectLater(
        responding({
          'notes': [
            {'id': noteId, 'revision': 'r', ...fields},
          ],
        }).notes('mbp'),
        throwsA(apiError(502)),
      );
    });
  }
  for (final operation in ['create', 'get', 'update']) {
    test('单条笔记响应校验：$operation', () async {
      await expectLater(
        invoke(responding({'title': '无 id'}), operation),
        throwsA(apiError(502)),
      );
    });
  }
  test('读取和更新拒绝响应 id 不匹配', () async {
    final api = responding({'id': workspaceId, 'revision': 'r'});
    for (final operation in ['get', 'update']) {
      await expectLater(invoke(api, operation), throwsA(apiError(502)));
    }
  });
  test('畸形 JSON 和错误正文不导致原始解析异常', () async {
    for (final status in [200, 503, 409]) {
      final api =
          MulticaApi(
              baseUrl: 'http://localhost',
              client: MockClient(
                (_) async => http.Response('private-broken-body', status),
              ),
            )
            ..token = 'test-session'
            ..workspaceId = workspaceId;
      await expectLater(
        api.shares(),
        throwsA(apiError(status == 200 ? 502 : status)),
      );
    }
  });
  for (final operation in operations) {
    test('非 JSON 401 统一清理并通知：$operation', () async {
      var invalidations = 0;
      final api =
          MulticaApi(
              baseUrl: 'http://localhost',
              client: MockClient(
                (_) async => http.Response('<html>unauthorized</html>', 401),
              ),
              onUnauthorized: () async {
                invalidations++;
              },
            )
            ..token = 'test-session'
            ..workspaceId = workspaceId;
      await expectLater(invoke(api, operation), throwsA(apiError(401)));
      expect(api.token, isNull);
      expect(api.workspaceId, isNull);
      expect(invalidations, 1);
    });
  }
  test('并发 401 只通知一次且旧响应不清理新会话', () async {
    var invalidations = 0;
    final pending = <Completer<http.Response>>[];
    final api =
        MulticaApi(
            baseUrl: 'http://localhost',
            client: MockClient((_) {
              final response = Completer<http.Response>();
              pending.add(response);
              return response.future;
            }),
            onUnauthorized: () async {
              invalidations++;
            },
          )
          ..token = 'test-session'
          ..workspaceId = workspaceId;
    final first = expectLater(api.shares(), throwsA(apiError(401)));
    final second = expectLater(api.shares(), throwsA(apiError(401)));
    await Future<void>.delayed(Duration.zero);
    pending[0].complete(http.Response('', 401));
    await first;
    api.token = 'replacement-session';
    api.workspaceId = workspaceId;
    pending[1].complete(http.Response('', 401));
    await second;
    expect(invalidations, 1);
    expect(api.token, 'replacement-session');
  });
  test('验证码 401 不触发已登录会话失效', () async {
    var invalidations = 0;
    final api = responding({'error': '验证码无效'}, status: 401);
    api.onUnauthorized = () async {
      invalidations++;
    };
    await expectLater(
      api.verifyCode('example@example.test', 'test-code'),
      throwsA(apiError(401)),
    );
    expect(invalidations, 0);
    expect(api.token, isNotNull);
  });
  for (final token in [null, '', ' ', 7, 'token\nheader']) {
    test('拒绝畸形登录凭证：${token.runtimeType}', () async {
      await expectLater(
        responding({'token': token})
            .verifyCode('example@example.test', 'test-code'),
        throwsA(apiError(502)),
      );
    });
  }
  test('超时覆盖响应正文且保留有效会话', () async {
    final stream = StreamController<List<int>>();
    final api =
        MulticaApi(
            baseUrl: 'http://localhost',
            requestTimeout: const Duration(milliseconds: 10),
            client: MockClient.streaming(
              (_, _) async => http.StreamedResponse(stream.stream, 200),
            ),
          )
          ..token = 'test-session'
          ..workspaceId = workspaceId;
    await expectLater(api.shares(), throwsA(apiError(408)));
    expect(api.token, isNotNull);
    await stream.close();
  });
  test('连接无响应时请求有期限', () async {
    final pending = Completer<http.Response>();
    final api =
        MulticaApi(
            baseUrl: 'http://localhost',
            requestTimeout: const Duration(milliseconds: 10),
            client: MockClient((_) => pending.future),
          )
          ..token = 'test-session'
          ..workspaceId = workspaceId;
    await expectLater(api.shares(), throwsA(apiError(408)));
    pending.complete(http.Response('{}', 200));
  });
  test('工作区变更后不接纳旧工作区响应', () async {
    final pending = Completer<http.Response>();
    final api =
        MulticaApi(
            baseUrl: 'http://localhost',
            client: MockClient((_) => pending.future),
          )
          ..token = 'test-session'
          ..workspaceId = workspaceId;
    final result = expectLater(api.shares(), throwsA(apiError(409)));
    await Future<void>.delayed(Duration.zero);
    api.workspaceId = noteId;
    pending.complete(http.Response('{"shares":[]}', 200));
    await result;
    expect(api.token, isNotNull);
  });
  test('退出后不接纳成功的旧会话响应', () async {
    final pending = Completer<http.Response>();
    final api =
        MulticaApi(
            baseUrl: 'http://localhost',
            client: MockClient((_) => pending.future),
          )
          ..token = 'test-session'
          ..workspaceId = workspaceId;
    final result = expectLater(api.shares(), throwsA(apiError(401)));
    await Future<void>.delayed(Duration.zero);
    api.clearSession();
    pending.complete(http.Response('{"shares":[]}', 200));
    await result;
  });
  test('错误信息隐藏服务端回显的凭证和验证码', () async {
    final api = responding({'error': 'test-session test-code'}, status: 400);
    await expectLater(
      api.verifyCode('example@example.test', 'test-code'),
      throwsA(
        isA<ApiException>().having((e) => e.message, 'message', '[已隐藏] [已隐藏]'),
      ),
    );
  });
  test('网络异常返回明确错误且保留会话', () async {
    final api =
        MulticaApi(
            baseUrl: 'http://localhost',
            client: MockClient(
              (_) async => throw http.ClientException('private detail'),
            ),
          )
          ..token = 'test-session'
          ..workspaceId = workspaceId;
    await expectLater(api.shares(), throwsA(apiError(0)));
    expect(api.token, isNotNull);
  });
}
