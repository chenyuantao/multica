import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/ai_chat.dart';
import 'package:imind_app/api.dart';
import 'package:uuid/uuid.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('real file chat realtime updates, isolation, reconnect and reopen', (
    tester,
  ) async {
    final api = MulticaApi(baseUrl: defaultApiBase())
      ..token = const String.fromEnvironment('E2E_TOKEN')
      ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
    const machine = String.fromEnvironment('E2E_MACHINE');
    addTearDown(api.close);
    final peerApi = MulticaApi(baseUrl: defaultApiBase())
      ..token = const String.fromEnvironment('E2E_PEER_TOKEN')
      ..workspaceId = api.workspaceId;
    addTearDown(peerApi.close);

    Future<T> real<T>(Future<T> Function() action) async =>
        (await tester.runAsync(action)) as T;
    Future<void> wait(Finder finder, {bool absent = false}) async {
      for (var i = 0; i < 300; i++) {
        await tester.pump(const Duration(milliseconds: 200));
        if (absent ? finder.evaluate().isEmpty : finder.evaluate().isNotEmpty) {
          return;
        }
      }
      expect(finder, absent ? findsNothing : findsWidgets);
    }

    Future<Map<String, dynamic>> external(
      String method,
      String path,
      Map<String, dynamic>? body,
    ) async => real(() async {
      final request = http.Request(method, Uri.parse('${api.baseUrl}$path'))
        ..headers.addAll({
          'Authorization': 'Bearer ${peerApi.token}',
          'X-Workspace-ID': api.workspaceId!,
          'Content-Type': 'application/json',
        });
      if (body != null) request.body = jsonEncode(body);
      final client = http.Client();
      try {
        final response = await http.Response.fromStream(
          await client.send(request),
        );
        expect(response.statusCode, inInclusiveRange(200, 299));
        return response.body.isEmpty
            ? <String, dynamic>{}
            : jsonDecode(response.body) as Map<String, dynamic>;
      } finally {
        client.close();
      }
    });
    expect(
      await real(api.workspaceAgents),
      isEmpty,
      reason: 'Never trigger a real agent during device regression',
    );
    final note = await real(
      () => api.createNote({
        'share_machine': machine,
        'type': 'note',
        'title': 'Chat device ${DateTime.now().millisecondsSinceEpoch}',
        'content': 'Saved context',
      }),
    );
    final other = await real(
      () => api.createNote({
        'share_machine': machine,
        'type': 'note',
        'title': 'Other chat ${DateTime.now().millisecondsSinceEpoch}',
        'content': 'Other context',
      }),
    );
    final chat = await real(
      () => api.ensureNoteChat(
        machine,
        note['id'] as String,
        revision: note['revision'] as String,
      ),
    );
    final otherChat = await real(
      () => api.ensureNoteChat(
        machine,
        other['id'] as String,
        revision: other['revision'] as String,
      ),
    );
    await real(
      () => peerApi.ensureNoteChat(
        machine,
        other['id'] as String,
        revision: other['revision'] as String,
      ),
    );
    final peerChat = await real(
      () => peerApi.ensureNoteChat(
        machine,
        note['id'] as String,
        revision: note['revision'] as String,
      ),
    );
    expect(peerChat['issue_id'], chat['issue_id']);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: NoteAiChatSheet(api: api, machine: machine, note: note),
        ),
      ),
    );
    await wait(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'Flutter device message');
    await tester.tap(find.byTooltip('发送'));
    await wait(find.text('Agent 暂不可用 · 重试'));
    final webMessage = await external(
      'POST',
      '/api/issues/${chat['issue_id']}/comments',
      {'content': 'Web live message', 'client_id': const Uuid().v4()},
    );
    await wait(find.text('Web live message'));
    await external('PUT', '/api/comments/${webMessage['id']}', {
      'content': 'Web edited message',
      'expected_revision': webMessage['revision'],
    });
    await wait(find.text('Web edited message'));
    await external('DELETE', '/api/comments/${webMessage['id']}', null);
    await wait(find.text('Web edited message'), absent: true);
    await external('POST', '/api/issues/${chat['issue_id']}/comments', {
      'content':
          '```docs\n${jsonEncode({'name': 'Shared md card', 'summary': 'Saved file context', 'path': note['path']})}\n```',
      'client_id': const Uuid().v4(),
    });
    await wait(find.text('Shared md card'));
    await tester.ensureVisible(find.text('Shared md card'));
    await tester.tap(find.text('Shared md card'));
    await wait(find.textContaining('Saved context'));
    await tester.tap(find.widgetWithText(TextButton, '关闭'));
    await tester.pumpAndSettle();
    debugPrint(
      'E2E_CHAT: Markdown md card rendered and opened through authorized real docs API',
    );
    await external('POST', '/api/issues/${otherChat['issue_id']}/comments', {
      'content': 'Other file hidden message',
      'client_id': const Uuid().v4(),
    });
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Other file hidden message'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: NoteAiChatSheet(api: peerApi, machine: machine, note: note),
        ),
      ),
    );
    await wait(find.text('Flutter device message'));
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: NoteAiChatSheet(api: api, machine: machine, note: note),
        ),
      ),
    );
    await wait(find.text('Flutter device message'));
    debugPrint(
      'E2E_CHAT: both users expanded the same md and joined identical persisted issue',
    );
    debugPrint(
      'E2E_CHAT: real Flutter send, Web created/updated/deleted events and cross-file isolation passed',
    );
    // The host runner restarts only the local Docker backend after this marker.
    debugPrint('E2E_CHAT_RECONNECT_NOW');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 12)),
    );
    Map<String, dynamic>? afterRestart;
    for (var i = 0; i < 30; i++) {
      try {
        afterRestart = await external(
          'POST',
          '/api/issues/${chat['issue_id']}/comments',
          {
            'content': 'After reconnect message',
            'client_id': const Uuid().v4(),
          },
        );
        break;
      } catch (_) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 1)),
        );
      }
    }
    expect(afterRestart, isNotNull);
    await wait(find.text('After reconnect message'));
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: NoteAiChatSheet(api: api, machine: machine, note: note),
        ),
      ),
    );
    await wait(find.text('Flutter device message'));
    await wait(find.text('After reconnect message'));
    expect(find.text('Other file hidden message'), findsNothing);
    expect(tester.takeException(), isNull);
    debugPrint(
      'E2E_CHAT: actual socket reconnect and reopened persisted history passed',
    );
  }, timeout: const Timeout(Duration(minutes: 5)));
}
