import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/ai_chat.dart';
import 'package:imind_app/api.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('Web composer and Flutter composer exchange realtime messages', (
    tester,
  ) async {
    final api = MulticaApi(baseUrl: defaultApiBase())
      ..token = const String.fromEnvironment('E2E_PEER_TOKEN')
      ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
    const machine = String.fromEnvironment('E2E_MACHINE');
    addTearDown(api.close);
    final owner = MulticaApi(baseUrl: defaultApiBase())
      ..token = const String.fromEnvironment('E2E_TOKEN')
      ..workspaceId = api.workspaceId;
    addTearDown(owner.close);
    Future<T> real<T>(Future<T> Function() action) async =>
        (await tester.runAsync(action)) as T;
    Future<void> wait(Finder finder) async {
      for (var i = 0; i < 900; i++) {
        await tester.pump(const Duration(milliseconds: 200));
        if (finder.evaluate().isNotEmpty) return;
      }
      expect(finder, findsWidgets);
    }

    expect(
      await real(api.workspaceAgents),
      isEmpty,
      reason: 'Never run a real agent during UI acceptance',
    );
    final note = await real(
      () => api.createNote({
        'share_machine': machine,
        'type': 'note',
        'title':
            'Web Flutter UI acceptance ${DateTime.now().millisecondsSinceEpoch}',
        'content': 'Saved file for Web and Flutter UI acceptance',
      }),
    );
    final chat = await real(
      () => api.ensureNoteChat(
        machine,
        note['id'] as String,
        revision: note['revision'] as String,
      ),
    );
    final ownerChat = await real(
      () => owner.ensureNoteChat(
        machine,
        note['id'] as String,
        revision: note['revision'] as String,
      ),
    );
    expect(ownerChat['issue_id'], chat['issue_id']);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: NoteAiChatSheet(api: api, machine: machine, note: note),
        ),
      ),
    );
    await wait(find.byType(TextField));
    debugPrint('E2E_INTEROP_CHAT:${chat['issue_id']}');
    debugPrint('E2E_INTEROP_READY');
    await wait(find.text('Web composer to Flutter P1'));
    debugPrint('E2E_INTEROP_WEB_RECEIVED');
    await tester.enterText(
      find.byType(TextField),
      'Flutter composer to Web P1',
    );
    await tester.tap(find.byTooltip('发送'));
    await wait(find.text('Agent 暂不可用 · 重试'));
    debugPrint('E2E_INTEROP_FLUTTER_SENT');
    await wait(find.text('Web confirms Flutter reply P1'));
    expect(tester.takeException(), isNull);
    debugPrint('E2E_INTEROP_BIDIRECTIONAL_PASSED');
  }, timeout: const Timeout(Duration(minutes: 10)));
}
