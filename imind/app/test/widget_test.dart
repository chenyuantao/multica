import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/chat_unread.dart';
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
    enableRealtime: false,
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
        '/api/imind/chats/unread' => {'chats': []},
        '/api/imind/bootstrap' => {},
        '/api/imind/chats/ensure' => {
          'issue_id': _otherWorkspace,
          'identifier': 'MUL-41',
          'joined': true,
        },
        '/api/issues/$_otherWorkspace/comments/page' => {
          'comments': [],
          'has_more': false,
        },
        '/api/issues/$_otherWorkspace/task-runs' => [],
        '/api/issues/$_otherWorkspace/comments' => {
          'id': '44444444-4444-4444-8444-444444444444',
          'issue_id': _otherWorkspace,
          'author_type': 'member',
          'author_id': _id,
          'content': jsonDecode(request.body)['content'],
          'created_at': '2026-10-28T00:00:00Z',
        },
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
  testWidgets('首页与详情显示文件群聊未读，展开后清除', (tester) async {
    var unread = 3;
    var reads = 0;
    final api = _api(
      intercept: (request) async {
        if (request.url.path == '/api/imind/chats/unread') {
          return http.Response(
            jsonEncode({
              'chats': [
                {
                  'note_id': _id,
                  'share_machine': 'mbp',
                  'issue_id': _otherWorkspace,
                  'title': '示例笔记',
                  'unread_count': unread,
                },
              ],
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (request.url.path == '/api/group-chats/$_otherWorkspace/read') {
          reads++;
          unread = 0;
          return http.Response('{"count":3}', 200);
        }
        return null;
      },
    );
    await _pump(tester, _storage(), api);
    expect((await api.noteChatUnread()).first['unread_count'], 3);
    final unreadController = ChatUnreadScope.maybeOf(
      tester.element(find.byType(HomePage)),
    )!;
    await unreadController.refresh();
    await tester.pump();
    expect(unreadController.unreadForNote(_id, 'mbp'), 3);
    expect(find.text('3'), findsOneWidget);
    await tester.tap(find.text('示例笔记').first);
    await tester.pumpAndSettle();
    expect(find.text('3'), findsOneWidget);
    await tester.tap(find.text('AI+').first);
    await tester.pumpAndSettle();
    expect(reads, greaterThan(0));
    expect(find.text('3'), findsNothing);
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
    expect(
      requests.any((request) => request.url.path == '/api/workspaces'),
      isTrue,
    );
    for (final request in requests.where(
      (request) => request.url.path != '/api/workspaces',
    )) {
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
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '修改后的正文');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    expect(find.text('发送验证码'), findsOneWidget);
    expect(find.byType(NoteEditor), findsNothing);
    expect(storage.values, isEmpty);
    expect(tester.takeException(), isNull);
  });
  testWidgets('打开文件群聊前保存笔记并持久发送消息', (tester) async {
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
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '修改后的正文');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AI+'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '整理重点');
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(find.text('整理重点'), findsOneWidget);
    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();
    expect(savedContent, '修改后的正文');
    expect(find.text('修改后的正文'), findsOneWidget);
    expect(find.text('放弃'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('失败消息重试复用 client_id 并只保留一个待发消息', (tester) async {
    final sendIds = <String>[];
    var failed = false;
    await _pump(
      tester,
      _storage(),
      _api(
        intercept: (request) async {
          if (request.url.path != '/api/issues/$_otherWorkspace/comments' ||
              request.method != 'POST') {
            return null;
          }
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          sendIds.add(body['client_id'] as String);
          if (!failed) {
            failed = true;
            return http.Response(jsonEncode({'error': 'Agent 暂时不可用'}), 503);
          }
          return null;
        },
      ),
    );
    await tester.tap(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AI+'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '请整理重点');
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('重试'), findsOneWidget);
    await tester.tap(find.byTooltip('重试'));
    await tester.pumpAndSettle();
    expect(sendIds, hasLength(2));
    expect(sendIds.first, isNotEmpty);
    expect(sendIds[1], sendIds.first);
    expect(find.text('请整理重点'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('无 Agent 时保留已发消息并允许重新派发', (tester) async {
    var retries = 0;
    await _pump(
      tester,
      _storage(),
      _api(
        intercept: (request) async {
          if (request.method == 'POST' &&
              request.url.path == '/api/issues/$_otherWorkspace/comments') {
            return http.Response(
              jsonEncode({
                'id': '44444444-4444-4444-8444-444444444444',
                'issue_id': _otherWorkspace,
                'author_type': 'member',
                'author_id': _id,
                'content': jsonDecode(request.body)['content'],
                'created_at': '2026-10-28T00:00:00Z',
                'imind_agent_status': 'unavailable',
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
          if (request.method == 'POST' &&
              request.url.path == '/api/imind/chats/$_otherWorkspace/retry') {
            retries++;
            expect(
              jsonDecode(request.body)['comment_id'],
              '44444444-4444-4444-8444-444444444444',
            );
            return http.Response(jsonEncode({'status': 'queued'}), 200);
          }
          return null;
        },
      ),
    );
    await tester.tap(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AI+'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '请总结这份笔记');
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(find.text('Agent 暂不可用 · 重试'), findsOneWidget);
    await tester.tap(find.text('Agent 暂不可用 · 重试'));
    await tester.pumpAndSettle();
    expect(retries, 1);
    expect(find.text('请总结这份笔记'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('多 Agent 活动运行分别取消对应 task，docs 卡片走授权读取', (tester) async {
    final cancelled = <String>[];
    var cancellationConfirmed = false;
    var agentNameRequests = 0;
    final requests = <String>[];
    final noteId1 = '66666666-6666-4666-8666-666666666666';
    final noteId2 = '77777777-7777-4777-8777-777777777777';
    await _pump(
      tester,
      _storage(),
      _api(
        intercept: (request) async {
          requests.add('${request.method} ${request.url.path}');
          if (request.url.path == '/api/agents') {
            agentNameRequests++;
            return http.Response(
              jsonEncode([
                {'id': noteId1, 'name': 'Agent A'},
                {'id': noteId2, 'name': 'Agent B'},
              ]),
              200,
            );
          }
          if (request.url.path == '/api/issues/$_otherWorkspace/task-runs') {
            return http.Response(
              jsonEncode([
                {'id': noteId1, 'status': 'running', 'agent_id': noteId1},
                {
                  'id': noteId2,
                  'status': cancellationConfirmed ? 'cancelled' : 'running',
                  'agent_id': noteId2,
                },
              ]),
              200,
            );
          }
          if (request.method == 'POST' &&
              request.url.path.contains('/tasks/') &&
              request.url.path.endsWith('/cancel')) {
            cancelled.add(request.url.path.split('/')[5]);
            return http.Response(
              jsonEncode({
                'id': request.url.path.split('/')[5],
                'status': 'running',
              }),
              200,
            );
          }
          if (request.url.path ==
              '/api/issues/$_otherWorkspace/comments/page') {
            return http.Response(
              jsonEncode({
                'comments': [
                  {
                    'id': noteId1,
                    'issue_id': _otherWorkspace,
                    'author_type': 'agent',
                    'author_id': '88888888-8888-4888-8888-888888888888',
                    'content': '```docs\n{"name":"方案","summary":"近期计划","path":"Notes/Plan.md"}\n```',
                    'created_at': '2026-10-28T00:00:00Z',
                  },
                ],
                'has_more': false,
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.url.path == '/api/docs/files/content') {
            expect(jsonDecode(request.body)['path'], 'Notes/Plan.md');
            return http.Response(
              jsonEncode({'content': '# 已授权文档内容'}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return null;
        },
      ),
    );
    await tester.tap(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AI+'));
    await tester.pumpAndSettle();
    expect(requests, contains('GET /api/issues/$_otherWorkspace/task-runs'));
    expect(find.byTooltip('终止 Agent A 的运行'), findsOneWidget);
    expect(find.byTooltip('终止 Agent B 的运行'), findsOneWidget);
    await tester.tap(find.byTooltip('终止 Agent B 的运行'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(cancelled, [noteId2]);
    final pendingStop = tester.widget<IconButton>(
      find.widgetWithIcon(IconButton, Icons.hourglass_top),
    );
    expect(pendingStop.onPressed, isNull);
    expect(find.byTooltip('终止 Agent A 的运行'), findsOneWidget);
    cancellationConfirmed = true;
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.hourglass_top), findsNothing);
    expect(agentNameRequests, 1);
    expect(find.text('Agent A'), findsOneWidget);
    expect(find.text(noteId1), findsNothing);
    await tester.tap(find.text('方案'));
    await tester.pumpAndSettle();
    expect(find.text('已授权文档内容'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('系统返回确认放弃，取消保留草稿', (tester) async {
    await _pump(tester, _storage(), _api());
    await tester.tap(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '未保存的修改');
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('放弃修改？'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(find.text('未保存的修改'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(of: find.byType(AlertDialog), matching: find.text('放弃')),
    );
    await tester.pumpAndSettle();
    expect(find.byType(NoteEditor), findsNothing);
    expect(find.text('示例笔记'), findsOneWidget);
  });

  for (final recording in [false, true]) {
    testWidgets('iOS 边缘滑动确认退出详情 recording=$recording', (tester) async {
      final api = _api();
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(platform: TargetPlatform.iOS),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                    builder: (_) => recording
                        ? RecordingDetail(
                            api: api,
                            machine: 'mbp',
                            note: {
                              ..._note(),
                              'type': 'recording',
                              'transcript': '原文',
                            },
                          )
                        : NoteEditor(api: api, machine: 'mbp', note: _note()),
                  ),
                ),
                child: const Text('打开详情'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('打开详情'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('更多'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('编辑'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, '保留草稿');
      await tester.dragFrom(const Offset(5, 350), const Offset(110, 0));
      await tester.pumpAndSettle();
      expect(find.text('放弃修改？'), findsOneWidget);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(find.text('保留草稿'), findsOneWidget);
      await tester.dragFrom(const Offset(5, 350), const Offset(110, 0));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('放弃'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('打开详情'), findsOneWidget);
      expect(
        find.byType(recording ? RecordingDetail : NoteEditor),
        findsNothing,
      );
    });

    testWidgets('顶部放弃直接退出详情 recording=$recording', (tester) async {
      final api = _api();
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                    builder: (_) => recording
                        ? RecordingDetail(
                            api: api,
                            machine: 'mbp',
                            note: {
                              ..._note(),
                              'type': 'recording',
                              'transcript': '原文',
                            },
                          )
                        : NoteEditor(api: api, machine: 'mbp', note: _note()),
                  ),
                ),
                child: const Text('打开详情'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('打开详情'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('更多'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('编辑'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('放弃'));
      await tester.pumpAndSettle();
      expect(find.text('放弃修改？'), findsNothing);
      expect(find.text('打开详情'), findsOneWidget);
    });
  }
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
  testWidgets('首页手动重命名读取完整笔记并保留正文转写音频', (tester) async {
    Map<String, dynamic>? written;
    var detailReads = 0;
    const audio = {
      'duration_ms': 1000,
      'format': 'wav_pcm_s16le',
      'sample_rate_hz': 16000,
      'file': 'audio.wav',
    };
    final full = {
      ..._note('完整录音正文'),
      'type': 'recording',
      'transcript': '保留原始转写',
      'audio': audio,
    };
    await _pump(
      tester,
      _storage(),
      _api(
        intercept: (request) async {
          Object? result;
          if (request.url.path == '/api/imind/notes/list') {
            result = {
              'notes': [
                {
                  'id': _id,
                  'revision': 'r',
                  'title': '示例笔记',
                  'type': 'recording',
                },
              ],
            };
          } else if (request.url.path == '/api/imind/notes/get') {
            detailReads++;
            result = full;
          } else if (request.method == 'PUT' &&
              request.url.path == '/api/imind/notes/$_id') {
            written = jsonDecode(request.body) as Map<String, dynamic>;
            result = {...full, ...written!};
          }
          return result == null
              ? null
              : http.Response(
                  jsonEncode(result),
                  200,
                  headers: {'content-type': 'application/json'},
                );
        },
      ),
    );
    await tester.longPress(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('重命名'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '用户新标题');
    await tester.tap(find.widgetWithText(TextButton, '完成'));
    await tester.pumpAndSettle();
    expect(detailReads, 1);
    expect(written!['title'], '用户新标题');
    expect(written!['revision'], 'r');
    expect(written!['content'], '完整录音正文');
    expect(written!['transcript'], '保留原始转写');
    expect(written!['audio'], audio);
  });
  testWidgets('智能体名称读取失败不阻断群聊且不显示UUID', (tester) async {
    const runId = '66666666-6666-4666-8666-666666666666';
    await _pump(
      tester,
      _storage(),
      _api(
        intercept: (request) async {
          if (request.url.path == '/api/agents') {
            return http.Response('{"error":"unavailable"}', 503);
          }
          if (request.url.path == '/api/issues/$_otherWorkspace/task-runs') {
            return http.Response(
              jsonEncode([
                {'id': runId, 'agent_id': runId, 'status': 'running'},
              ]),
              200,
            );
          }
          return null;
        },
      ),
    );
    await tester.tap(find.text('示例笔记'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AI+'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('终止 Agent 的运行'), findsOneWidget);
    expect(find.text('Agent'), findsOneWidget);
    expect(find.text(runId), findsNothing);
    expect(find.byTooltip('发送'), findsOneWidget);
  });
}
