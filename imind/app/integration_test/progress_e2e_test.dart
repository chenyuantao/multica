import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/ai_chat.dart';
import 'package:imind_app/api.dart';

// The host runner creates offline, queue-only database fixtures in the local
// acceptance workspace. No agent executable is resolved or invoked.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'message run opens real execution detail and cancels only its run',
    (tester) async {
      final api = MulticaApi(baseUrl: defaultApiBase())
        ..token = const String.fromEnvironment('E2E_TOKEN')
        ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
      const machine = String.fromEnvironment('E2E_MACHINE');
      const noteId = String.fromEnvironment('E2E_PROGRESS_NOTE');
      const taskId = String.fromEnvironment('E2E_PROGRESS_RUN');
      const otherTaskId = String.fromEnvironment('E2E_PROGRESS_OTHER_RUN');
      const otherIssueId = String.fromEnvironment('E2E_PROGRESS_OTHER_ISSUE');
      expect(
        Uri.parse(api.baseUrl).host,
        anyOf('127.0.0.1', 'localhost', '10.0.2.2'),
      );
      for (final id in [noteId, taskId, otherTaskId, otherIssueId]) {
        expect(
          validWorkspaceId(id),
          isTrue,
          reason: 'Host must seed local progress fixtures',
        );
      }
      addTearDown(api.close);
      Future<T> real<T>(Future<T> Function() action) async =>
          (await tester.runAsync(action)) as T;
      Future<void> wait(Finder finder, {bool absent = false}) async {
        for (var i = 0; i < 300; i++) {
          await tester.pump(const Duration(milliseconds: 200));
          if (absent
              ? finder.evaluate().isEmpty
              : finder.evaluate().isNotEmpty) {
            return;
          }
        }
        expect(finder, absent ? findsNothing : findsWidgets);
      }

      final note = await real(() => api.getNote(machine, noteId));
      final chat = await real(
        () => api.ensureNoteChat(
          machine,
          noteId,
          revision: note['revision'] as String,
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: NoteAiChatSheet(api: api, machine: machine, note: note),
          ),
        ),
      );
      final runBubble = find.byKey(ValueKey('run-message-$taskId'));
      await wait(runBubble);
      await wait(find.text('iMind progress fixture'));
      final view = find.descendant(of: runBubble, matching: find.text('查看'));
      await tester.ensureVisible(view);
      await tester.tap(view);
      await wait(find.text('执行过程'));
      await wait(find.text('思考'));
      expect(find.text('暂无执行过程'), findsNothing);
      await tester.pumpAndSettle();
      debugPrint('E2E_PROGRESS: real task transcript opened on separate page');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 2)),
      );
      await tester.tap(find.widgetWithText(TextButton, '终止'));
      await wait(find.textContaining('已取消'));
      expect(find.widgetWithText(TextButton, '终止'), findsNothing);
      await tester.tap(find.byType(BackButton));
      await wait(find.text('执行过程'), absent: true);
      await wait(find.byType(TextField));
      final runs = await real(
        () => api.noteChatRuns(chat['issue_id'] as String),
      );
      expect(
        runs.singleWhere((run) => run['id'] == taskId)['status'],
        'cancelled',
      );
      final otherRuns = await real(() => api.noteChatRuns(otherIssueId));
      expect(
        otherRuns.singleWhere((run) => run['id'] == otherTaskId)['status'],
        'queued',
      );
      expect(tester.takeException(), isNull);
      debugPrint(
        'E2E_PROGRESS: exact message run cancelled; other file run remained queued; own back returned to chat',
      );
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    },
    timeout: const Timeout(Duration(minutes: 4)),
  );
}
