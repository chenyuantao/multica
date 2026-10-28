import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/session.dart';

import 'session_test.dart' show MemorySessionStorage;

const _workspace = '11111111-1111-4111-8111-111111111111';
const _otherWorkspace = '33333333-3333-4333-8333-333333333333';
const _id = '22222222-2222-4222-8222-222222222222';
const _base = 'http://localhost';

Map<String, dynamic> _note([String content = '示例正文']) => {
  'id': _id,
  'revision': 'r',
  'title': '示例笔记',
  'type': 'note',
  'content': content,
};

MemorySessionStorage _storage({
  String workspace = _workspace,
  String machine = 'mbp',
}) {
  final storage = MemorySessionStorage();
  storage.values[SessionStore.sessionKey] = jsonEncode({
    'base_url': _base,
    'token': 'test-session',
    'workspace_id': workspace,
    'share_machine': machine,
  });
  return storage;
}

MulticaApi _api({
  Future<http.Response?> Function(http.Request request)? intercept,
}) {
  final api = MulticaApi(
    baseUrl: _base,
    client: MockClient((request) async {
      final overridden = await intercept?.call(request);
      if (overridden != null) return overridden;
      final Object response = switch (request.url.path) {
        '/api/workspaces' => [
          {'id': _workspace},
        ],
        '/api/imind/shares' => {
          'shares': [
            {'machine': 'mbp'},
            {'machine': 'desktop'},
          ],
        },
        '/api/imind/notes/list' => {
          'notes': [_note()],
        },
        '/api/imind/bootstrap' => {},
        _ => _note(),
      };
      return http.Response(
        jsonEncode(response),
        200,
        headers: {'content-type': 'application/json'},
      );
    }),
  );
  addTearDown(api.close);
  return api;
}

Future<void> _pump(
  WidgetTester tester,
  MemorySessionStorage storage,
  MulticaApi api,
) async {
  await tester.pumpWidget(
    IMindApp(
      api: api,
      sessionStore: SessionStore(storage: storage),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('login is the signed-out home', (tester) async {
    await tester.pumpWidget(const IMindApp(initialToken: ''));
    expect(find.text('发送验证码'), findsOneWidget);
    expect(find.text('在这里，记录你的一切。'), findsOneWidget);
  });
  testWidgets('恢复有效选择并在共享根请求前校验工作区', (tester) async {
    final requests = <http.Request>[];
    final storage = _storage(machine: 'desktop');
    await _pump(
      tester,
      storage,
      _api(
        intercept: (request) async {
          requests.add(request);
          return null;
        },
      ),
    );
    expect(find.text('示例笔记'), findsOneWidget);
    expect(requests.first.url.path, '/api/workspaces');
    for (final request in requests.skip(1)) {
      expect(request.headers['X-Workspace-ID'], _workspace);
      if (request.method == 'POST') {
        expect(jsonDecode(request.body)['share_machine'], 'desktop');
      }
    }
    expect(
      jsonDecode(storage.values[SessionStore.sessionKey]!)['share_machine'],
      'desktop',
    );
  });
  testWidgets('失效工作区不复用其它工作区保存的共享根', (tester) async {
    final storage = _storage(workspace: _otherWorkspace, machine: 'desktop');
    final machines = <String>[];
    await _pump(
      tester,
      storage,
      _api(
        intercept: (request) async {
          if (request.method == 'POST') {
            machines.add(jsonDecode(request.body)['share_machine'] as String);
          }
          return null;
        },
      ),
    );
    expect(machines, everyElement('mbp'));
    final saved = jsonDecode(storage.values[SessionStore.sessionKey]!);
    expect(saved['workspace_id'], _workspace);
    expect(saved['share_machine'], 'mbp');
  });
  testWidgets('失效共享根只从当前授权列表重新选择', (tester) async {
    final storage = _storage(machine: 'missing');
    await _pump(tester, storage, _api());
    expect(
      jsonDecode(storage.values[SessionStore.sessionKey]!)['share_machine'],
      'mbp',
    );
    expect(find.text('示例笔记'), findsOneWidget);
  });
  for (final emptyWorkspaces in [true, false]) {
    testWidgets('空工作区或共享根给明确提示且不继续请求：$emptyWorkspaces', (tester) async {
      final storage = _storage();
      final requests = <http.Request>[];
      await _pump(
        tester,
        storage,
        _api(
          intercept: (request) async {
            requests.add(request);
            if (emptyWorkspaces && request.url.path == '/api/workspaces') {
              return http.Response('[]', 200);
            }
            if (!emptyWorkspaces && request.url.path == '/api/imind/shares') {
              return http.Response('{"shares":[]}', 200);
            }
            return null;
          },
        ),
      );
      expect(
        find.text(emptyWorkspaces ? '当前账号没有可访问的工作区' : '当前工作区还没有已连接的共享知识库'),
        findsOneWidget,
      );
      expect(requests.any((r) => r.url.path.contains('bootstrap')), isFalse);
      expect(
        jsonDecode(storage.values[SessionStore.sessionKey]!)['share_machine'],
        isNull,
      );
    });
  }
  testWidgets('畸形共享根响应显示边界错误而非崩溃', (tester) async {
    await _pump(
      tester,
      _storage(),
      _api(
        intercept: (request) async => request.url.path == '/api/imind/shares'
            ? http.Response('{"shares":[{"machine":7}]}', 200)
            : null,
      ),
    );
    expect(find.text('服务器返回的数据格式错误：share.machine'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('首页 401 清理凭证并回到登录', (tester) async {
    final storage = _storage();
    final api = _api(
      intercept: (request) async => request.url.path == '/api/imind/shares'
          ? http.Response('unauthorized', 401)
          : null,
    );
    await _pump(tester, storage, api);
    expect(find.text('发送验证码'), findsOneWidget);
    expect(storage.values, isEmpty);
    expect(api.token, isNull);
    expect(api.workspaceId, isNull);
  });
  testWidgets('编辑页保存 401 撤销整个已认证路由栈', (tester) async {
    final storage = _storage();
    final api = _api(
      intercept: (request) async =>
          request.method == 'PUT' ? http.Response('unauthorized', 401) : null,
    );
    await _pump(tester, storage, api);
    await tester.tap(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('示例正文'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '修改后的正文');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    expect(find.text('发送验证码'), findsOneWidget);
    expect(find.byType(NoteEditor), findsNothing);
    expect(storage.values, isEmpty);
    expect(tester.takeException(), isNull);
  });
  testWidgets('保留笔记编辑保存与 AI+ 本地 Mock', (tester) async {
    String? savedContent;
    await _pump(
      tester,
      _storage(),
      _api(
        intercept: (request) async {
          if (request.method != 'PUT') return null;
          savedContent = jsonDecode(request.body)['content'] as String;
          return http.Response(
            jsonEncode(_note(savedContent!)),
            200,
            headers: {'content-type': 'application/json'},
          );
        },
      ),
    );
    await tester.tap(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('示例正文'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '修改后的正文');
    await tester.tap(find.text('AI+'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '整理重点');
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(find.text('（Mock）已收到：整理重点。正式模型接口尚未接入。'), findsOneWidget);
    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    expect(savedContent, '修改后的正文');
    expect(find.text('修改后的正文'), findsOneWidget);
    expect(find.text('放弃'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('系统返回保留编辑放弃与返回首页行为', (tester) async {
    await _pump(tester, _storage(), _api());
    await tester.tap(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('示例正文'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '未保存的修改');
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(NoteEditor), findsOneWidget);
    expect(find.text('示例正文'), findsOneWidget);
    expect(find.text('放弃'), findsNothing);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(NoteEditor), findsNothing);
    expect(find.text('示例笔记'), findsOneWidget);
  });
  testWidgets('验证码登录成功后保存完整会话并保留首页', (tester) async {
    final storage = MemorySessionStorage();
    await _pump(
      tester,
      storage,
      _api(
        intercept: (request) async {
          if (request.url.path == '/auth/verify-code') {
            return http.Response('{"token":"test-session"}', 200);
          }
          return null;
        },
      ),
    );
    await tester.enterText(
      find.byType(TextField).first,
      'example@example.test',
    );
    await tester.tap(find.text('发送验证码'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'test-code');
    await tester.tap(find.text('登录'));
    await tester.pumpAndSettle();
    expect(find.text('示例笔记'), findsOneWidget);
    final saved = jsonDecode(storage.values[SessionStore.sessionKey]!);
    expect(saved['workspace_id'], _workspace);
    expect(saved['share_machine'], 'mbp');
  });
  testWidgets('手动退出清理工作区与共享根', (tester) async {
    final storage = _storage();
    await _pump(tester, storage, _api());
    await tester.tap(find.byTooltip('菜单'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('退出登录'));
    await tester.pumpAndSettle();
    expect(find.text('发送验证码'), findsOneWidget);
    expect(storage.values, isEmpty);
  });
}
