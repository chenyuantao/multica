import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart' hide Flow;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/chat_unread.dart';
import 'package:imind_app/main.dart';
import 'package:uuid/uuid.dart';

import 'features_e2e_test.dart' show Flow;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'two users: native notifications, unread, read, reconnect and logout',
    (tester) async {
      final f = Flow(tester);
      final peer = MulticaApi(baseUrl: defaultApiBase())
        ..token = const String.fromEnvironment('E2E_PEER_TOKEN')
        ..workspaceId = f.api.workspaceId;
      const inspection = MethodChannel('imind/notification_inspection');
      final notes = <Map<String, dynamic>>[];
      final chats = <String>[];
      Map<String, dynamic>? otherRootNote;
      const otherMachine = String.fromEnvironment('E2E_OTHER_MACHINE');
      Future<void> until(bool Function() condition) async {
        final deadline = DateTime.now().add(const Duration(seconds: 40));
        while (!condition() && DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 150));
        }
        expect(condition(), isTrue);
      }

      Future<Map<dynamic, dynamic>> native() async {
        return (await tester.runAsync(
          () => inspection
              .invokeMapMethod<dynamic, dynamic>('state')
              .timeout(const Duration(seconds: 30)),
        ))!;
      }

      Future<void> nativeCount(
        int count, {
        String? delivered,
        bool absent = false,
      }) async {
        Map<dynamic, dynamic> state = {};
        final deadline = DateTime.now().add(const Duration(seconds: 15));
        do {
          await tester.pump(const Duration(milliseconds: 200));
          state = await native();
          final ids = state['delivered'] as List;
          if (state['badge'] == count &&
              (delivered == null ||
                  ids.contains('imind-chat-$delivered') != absent)) {
            break;
          }
        } while (DateTime.now().isBefore(deadline));
        expect(state['badge'], count, reason: 'Actual native badge state');
        if (delivered != null) {
          expect(
            (state['delivered'] as List).contains('imind-chat-$delivered'),
            !absent,
          );
        }
        debugPrint('E2E_NOTIFICATION_NATIVE: ${jsonEncode(state)}');
      }

      Future<void> send(int index, String text) async {
        final client = http.Client();
        try {
          final response = await client.post(
            Uri.parse('${peer.baseUrl}/api/issues/${chats[index]}/comments'),
            headers: {
              'Authorization': 'Bearer ${peer.token}',
              'X-Workspace-ID': peer.workspaceId!,
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'content': text, 'client_id': const Uuid().v4()}),
          );
          expect(response.statusCode, inInclusiveRange(200, 299));
        } finally {
          client.close();
        }
      }

      Future<void> capture(String marker) async {
        debugPrint('E2E_DETAIL_CAPTURE: notifications-$marker');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 3)),
        );
      }

      try {
        expect(
          await f.api.workspaceAgents(),
          isEmpty,
          reason: 'No real agent CLI in device regression',
        );
        for (var i = 0; i < 2; i++) {
          final note = await f.api.createNote({
            'share_machine': Flow.machine,
            'type': 'note',
            'title': '通知验收 $i ${DateTime.now().microsecondsSinceEpoch}',
            'content': 'Notification E2E',
          });
          notes.add(note);
          final chat = await f.api.ensureNoteChat(
            Flow.machine,
            '${note['id']}',
            revision: '${note['revision']}',
          );
          final peerChat = await peer.ensureNoteChat(
            Flow.machine,
            '${note['id']}',
            revision: '${note['revision']}',
          );
          expect(peerChat['issue_id'], chat['issue_id']);
          chats.add('${chat['issue_id']}');
        }
        otherRootNote = await f.api.createNote({
          'share_machine': otherMachine,
          'type': 'note',
          'title': '隔离共享根 ${DateTime.now().microsecondsSinceEpoch}',
          'content': 'Other real root fixture',
        });
        await f.start();
        await f.wait(find.text('${notes[0]['title']}'));
        final unread = ChatUnreadScope.maybeOf(
          tester.element(find.byType(HomePage)),
        )!;
        await unread.refresh();
        final baseline = (await f.api.noteChatUnread()).fold<int>(
          0,
          (sum, row) => sum + (row['unread_count'] as int),
        );
        await until(() => unread.totalUnread == baseline);
        if (!const bool.fromEnvironment('E2E_NOTIFICATIONS_DENIED')) {
          final permissionDeadline = DateTime.now().add(
            const Duration(seconds: 45),
          );
          while ((await native())['authorized'] != true &&
              DateTime.now().isBefore(permissionDeadline)) {
            await tester.runAsync(
              () => Future<void>.delayed(const Duration(milliseconds: 250)),
            );
          }
        }
        final permissionState = await native();
        debugPrint(
          'E2E_NOTIFICATION_PERMISSION_STATE: ${jsonEncode(permissionState)}',
        );
        expect(
          permissionState['authorized'],
          !const bool.fromEnvironment('E2E_NOTIFICATIONS_DENIED'),
          reason: 'Set actual OS notification permission before this suite',
        );
        if (const bool.fromEnvironment('E2E_NOTIFICATIONS_DENIED')) {
          expect(permissionState['authorized'], isFalse);
          if (Platform.isIOS) expect(permissionState['authorizationStatus'], 1);
          await send(0, 'Permission denied still updates in-app unread');
          await until(
            () => unread.unreadForNote('${notes[0]['id']}', Flow.machine) == 1,
          );
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(seconds: 2)),
          );
          expect(
            (await native())['delivered'],
            isNot(contains('imind-chat-${chats[0]}')),
          );
          await f.tap(find.text('${notes[0]['title']}'));
          await f.wait(find.byType(AiChatButton));
          expect(
            find.descendant(
              of: find.byType(AiChatButton),
              matching: find.byType(ChatUnreadBadge),
            ),
            findsOneWidget,
          );
          await f.tap(find.byType(AiChatButton));
          await f.wait(
            find.text('Permission denied still updates in-app unread'),
          );
          await until(
            () => unread.unreadForNote('${notes[0]['id']}', Flow.machine) == 0,
          );
          await capture('permission-denied');
          debugPrint(
            'E2E_NOTIFICATIONS: actual OS permission denied, no native notification, in-app unread/read still works',
          );
          return;
        }
        await send(0, 'Second user foreground message');
        await until(
          () => unread.unreadForNote('${notes[0]['id']}', Flow.machine) == 1,
        );
        expect(unread.totalUnread, baseline + 1);
        expect(
          tester
              .widgetList<ChatUnreadBadge>(find.byType(ChatUnreadBadge))
              .map((w) => w.count),
          contains(1),
        );
        await nativeCount(baseline + 1, delivered: chats[0]);
        await capture('home');
        await f.tap(find.text('${notes[0]['title']}'));
        await f.wait(find.byType(AiChatButton));
        // Detail prefetch must preserve unread before actually opening AI+.
        expect(unread.unreadForNote('${notes[0]['id']}', Flow.machine), 1);
        expect(
          find.descendant(
            of: find.byType(AiChatButton),
            matching: find.byType(ChatUnreadBadge),
          ),
          findsOneWidget,
        );
        await capture('detail');
        await f.tap(find.byType(AiChatButton));
        await f.wait(find.text('Second user foreground message'));
        await until(
          () => unread.unreadForNote('${notes[0]['id']}', Flow.machine) == 0,
        );
        await nativeCount(baseline, delivered: chats[0], absent: true);
        await send(0, 'While current chat is expanded');
        await f.wait(find.text('While current chat is expanded'));
        await until(
          () => unread.unreadForNote('${notes[0]['id']}', Flow.machine) == 0,
        );
        await nativeCount(baseline, delivered: chats[0], absent: true);
        await send(1, 'Other file while current chat is expanded');
        await until(
          () => unread.unreadForNote('${notes[1]['id']}', Flow.machine) == 1,
        );
        expect(
          find.text('Other file while current chat is expanded'),
          findsNothing,
        );
        await nativeCount(baseline + 1, delivered: chats[1]);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await f.tap(find.byTooltip('返回'));
        await f.wait(find.byTooltip('菜单'));
        // Let the detail-return reload finish before changing session plumbing.
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 3)),
        );
        final homeBeforeBackground = tester.widget<HomePage>(
          find.byType(HomePage),
        );
        await homeBeforeBackground.session.select(
          f.api.workspaceId,
          otherMachine,
        );
        await tester.pumpAndSettle();
        expect(homeBeforeBackground.session.data!.machine, otherMachine);
        // Returning from a row can leave the list scrolled; reach its edge first.
        await tester.drag(find.byType(RefreshIndicator), const Offset(0, 1000));
        await tester.pumpAndSettle();
        await tester.drag(find.byType(RefreshIndicator), const Offset(0, 450));
        await f.wait(find.text('${otherRootNote['title']}'));
        expect(find.text('${notes[1]['title']}'), findsNothing);
        expect(unread.unreadForNote('${notes[1]['id']}', otherMachine), 0);
        expect(
          unread.totalUnread,
          baseline + 1,
          reason: 'App badge covers all accessible workspace roots',
        );
        await homeBeforeBackground.session.select(
          f.api.workspaceId,
          Flow.machine,
        );
        await tester.pumpAndSettle();
        await tester.drag(find.byType(RefreshIndicator), const Offset(0, 450));
        await f.wait(find.text('${notes[1]['title']}'));
        expect(find.text('${otherRootNote['title']}'), findsNothing);
        debugPrint('E2E_NOTIFICATION_BACKGROUND:${chats[1]}');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 35)),
        );
        await until(
          () => unread.unreadForNote('${notes[1]['id']}', Flow.machine) == 2,
        );
        await nativeCount(baseline + 2, delivered: chats[1]);
        await capture('foreground-return');
        debugPrint('E2E_CHAT_RECONNECT_NOW');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 12)),
        );
        for (var i = 0; ; i++) {
          try {
            await send(1, 'After actual backend restart');
            break;
          } catch (_) {
            if (i >= 20) rethrow;
            await tester.runAsync(
              () => Future<void>.delayed(const Duration(seconds: 1)),
            );
          }
        }
        await until(
          () => unread.unreadForNote('${notes[1]['id']}', Flow.machine) == 3,
        );
        await nativeCount(baseline + 3, delivered: chats[1]);
        expect((await native())['delivered'], ['imind-chat-${chats[1]}'], reason: 'Reconnect must not re-notify historical unread from restored shares');
        await capture('reconnected');
        final home = tester.widget<HomePage>(find.byType(HomePage));
        final original = home.session.data!;
        // Session API is the same entry point used by account/workspace plumbing.
        await home.session.select(
          const String.fromEnvironment('E2E_OTHER_WORKSPACE'),
          null,
        );
        await tester.pumpAndSettle();
        await until(() => unread.totalUnread == 0);
        await nativeCount(0, delivered: chats[1], absent: true);
        await home.session.select(original.workspaceId, original.machine);
        await tester.pumpAndSettle();
        await until(
          () => unread.unreadForNote('${notes[1]['id']}', Flow.machine) == 3,
        );
        await nativeCount(baseline + 3);
        await f.tap(find.text('${notes[1]['title']}'));
        await f.wait(find.byType(AiChatButton));
        await f.tap(find.byType(AiChatButton));
        await f.wait(find.text('After actual backend restart'));
        await until(
          () => unread.unreadForNote('${notes[1]['id']}', Flow.machine) == 0,
        );
        await nativeCount(baseline);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await f.tap(find.byTooltip('返回'));
        await f.wait(find.byTooltip('菜单'));
        await f.tap(find.byTooltip('菜单'));
        await f.tap(find.byTooltip('退出登录'));
        await f.wait(find.text('发送验证码'));
        expect(unread.totalUnread, 0);
        await nativeCount(0);
        await send(0, 'After logout must not notify old session');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 2)),
        );
        await nativeCount(0, delivered: chats[0], absent: true);
        expect(tester.takeException(), isNull);
        debugPrint(
          'E2E_NOTIFICATIONS: real peer, native delivery/badge, home/detail/read, active isolation, reconnect, workspace switch and logout passed',
        );
      } finally {
        await tester.pumpWidget(const SizedBox());
        await tester.pumpAndSettle();
        for (final note in notes) {
          final current = await f.api.getNote(Flow.machine, '${note['id']}');
          await f.api.deleteNote(
            '${note['id']}',
            Flow.machine,
            '${current['revision']}',
          );
        }
        if (otherRootNote != null) {
          final saved = await f.api.getNote(
            otherMachine,
            '${otherRootNote['id']}',
          );
          await f.api.deleteNote(
            '${saved['id']}',
            otherMachine,
            '${saved['revision']}',
          );
        }
        peer.close();
        f.api.close();
      }
    },
    timeout: const Timeout(Duration(minutes: 6)),
  );
}
