import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/chat_unread.dart';
import 'package:imind_app/session.dart';

const workspace = '11111111-1111-4111-8111-111111111111';
const note = '22222222-2222-4222-8222-222222222222';
const issue = '33333333-3333-4333-8333-333333333333';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('新未读通知、标记已读和退出角标使用同一份服务端状态', () async {
    final calls = <MethodCall>[];
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    const channel = MethodChannel('imind/chat_notifications');
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return null;
    });
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));

    var count = 1;
    final api =
        MulticaApi(
            baseUrl: 'http://localhost',
            enableRealtime: false,
            client: MockClient((request) async {
              if (request.url.path == '/api/imind/chats/unread') {
                return http.Response(
                  jsonEncode({
                    'chats': [
                      {
                        'share_machine': 'mbp',
                        'note_id': note,
                        'issue_id': issue,
                        'title': '文件群聊',
                        'unread_count': count,
                      },
                    ],
                  }),
                  200,
                  headers: {'content-type': 'application/json'},
                );
              }
              if (request.url.path == '/api/group-chats/$issue/read') {
                count = 0;
                return http.Response('{"count":2}', 200);
              }
              throw StateError('unexpected request: ${request.url.path}');
            }),
          )
          ..token = 'session'
          ..workspaceId = workspace;
    addTearDown(api.close);
    final controller = ChatUnreadController(api);
    addTearDown(controller.dispose);
    controller.configure(
      const SessionData(
        baseUrl: 'http://localhost',
        token: 'session',
        workspaceId: workspace,
        machine: 'mbp',
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.unreadForNote(note, 'mbp'), 1);
    expect(calls.where((call) => call.method == 'notify'), isEmpty);

    count = 2;
    await controller.refresh();
    await Future<void>.delayed(Duration.zero);
    expect(controller.totalUnread, 2);
    expect(calls.where((call) => call.method == 'notify'), hasLength(1));

    await controller.markRead(issue);
    await Future<void>.delayed(Duration.zero);
    expect(controller.unreadForNote(note, 'mbp'), 0);
    expect(calls.where((call) => call.method == 'clearChat'), isNotEmpty);

    controller.configure(null);
    await Future<void>.delayed(Duration.zero);
    expect(controller.totalUnread, 0);
    expect(calls.lastWhere((call) => call.method == 'setBadge').arguments, {
      'count': 0,
    });
    expect(calls.where((call) => call.method == 'clearAll'), isNotEmpty);
  });
}
