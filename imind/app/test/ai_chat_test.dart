import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/ai_chat.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/note_chat_prefetch.dart';

const issueId = '11111111-1111-4111-8111-111111111111';
const noteId = '22222222-2222-4222-8222-222222222222';

class ChatApi extends MulticaApi {
  ChatApi() : super(baseUrl: 'http://localhost', enableRealtime: false);
  final read = Completer<void>();
  int olderRequests = 0;
  List<Map<String, dynamic>> agentRows = [];
  final sent = <String>[];
  final clientIds = <String>[];
  bool failSend = false;

  @override
  Future<Map<String, dynamic>> sendNoteChatMessage(
    String issueId,
    String content, {
    required String clientId,
  }) async {
    sent.add(content);
    clientIds.add(clientId);
    if (failSend) throw ApiException(403, '无法邀请 Agent');
    return {
      'id': 'sent-message',
      'issue_id': issueId,
      'content': content,
      'author_type': 'member',
      'author_id': 'me',
      'created_at': '2026-10-31T00:00:00Z',
    };
  }

  @override
  Future<Map<String, dynamic>> ensureNoteChat(
    String machine,
    String noteId, {
    required String revision,
  }) async => {'issue_id': issueId};
  @override
  Future<Map<String, dynamic>> getMe() async => {'id': 'me'};
  @override
  Future<List<Map<String, dynamic>>> workspaceAgents() async => agentRows;
  @override
  Future<List<Map<String, dynamic>>> noteChatRuns(String issueId) async => [];
  @override
  Future<void> markNoteChatRead(String issueId) => read.future;
  @override
  Future<Map<String, dynamic>> noteChatHistory(
    String issueId, {
    String? beforeCreatedAt,
    String? beforeId,
    int limit = 50,
  }) async {
    if (beforeId != null) olderRequests++;
    return {
      'has_more': beforeId == null,
      'comments': [
        for (
          var i = beforeId == null ? 0 : -10;
          i < (beforeId == null ? 40 : 0);
          i++
        )
          {
            'id': 'message-$i',
            'issue_id': issueId,
            'created_at': DateTime.utc(2026, 10, 30, 0, i).toIso8601String(),
            'author_type': 'member',
            'author_id': 'me',
            'content': '消息 $i',
          },
      ],
    };
  }
}

Future<ChatApi> openChat(WidgetTester tester, {ChatApi? providedApi}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(400, 800);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetViewInsets);
  final api = providedApi ?? ChatApi();
  addTearDown(api.close);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showNoteAiChat(
              context,
              api: api,
              machine: 'mbp',
              note: {'id': noteId, 'revision': 'r', 'title': '剪藏'},
            ),
            child: const Text('打开群聊'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('打开群聊'));
  // Keep the read receipt pending while history and the sheet finish loading.
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump();
  api.read.complete();
  await tester.pumpAndSettle();
  return api;
}

void expectLatestVisible(WidgetTester tester) {
  final latest = find.text('消息 39');
  expect(latest.hitTestable(), findsOneWidget);
  final composer = find.byKey(const ValueKey('ai-composer'));
  expect(
    tester.getBottomLeft(latest).dy,
    lessThan(tester.getTopLeft(composer).dy),
  );
}

void main() {
  test(
    'prepared requests are scoped to note revision, machine and session',
    () async {
      final api = ChatApi();
      addTearDown(api.close);
      final note = <String, dynamic>{'id': noteId, 'revision': 'r'};
      final prepared = NoteChatPrefetch(api, 'mbp', note);
      await prepared.history;
      expect(prepared.matches(api, 'mbp', note), isTrue);
      expect(prepared.matches(api, 'other', note), isFalse);
      expect(
        prepared.matches(api, 'mbp', {...note, 'revision': 'new'}),
        isFalse,
      );
      expect(prepared.matches(api, 'mbp', {...note, 'id': issueId}), isFalse);
      api.workspaceId = issueId;
      expect(prepared.matches(api, 'mbp', note), isFalse);
      api.workspaceId = null;
      api.token = 'new-session';
      expect(prepared.matches(api, 'mbp', note), isFalse);
    },
  );
  testWidgets('history scrolls to newest after delayed initial loading', (
    tester,
  ) async {
    final api = await openChat(tester);
    expectLatestVisible(tester);
    expect(api.olderRequests, 0);
  });

  testWidgets(
    'keyboard raises messages and keeps the latest above the composer',
    (tester) async {
      await openChat(tester);
      await tester.drag(find.byType(ListView), const Offset(0, 450));
      await tester.pumpAndSettle();
      expect(find.text('消息 39').hitTestable(), findsNothing);
      await tester.tap(find.byType(TextField));
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();
      expectLatestVisible(tester);
      final composer = tester.getRect(
        find.byKey(const ValueKey('ai-composer')),
      );
      expect(composer.bottom, lessThanOrEqualTo(500));
      tester.view.viewInsets = const FakeViewPadding(bottom: 340);
      await tester.pumpAndSettle();
      expectLatestVisible(tester);
      expect(
        tester.getBottomLeft(find.byKey(const ValueKey('ai-composer'))).dy,
        lessThanOrEqualTo(460),
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('scrolling to oldest loads history without jumping to newest', (
    tester,
  ) async {
    final api = await openChat(tester);
    for (var i = 0; i < 10 && api.olderRequests == 0; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, 800));
      await tester.pumpAndSettle();
    }
    expect(api.olderRequests, 1);
    expect(find.text('消息 39').hitTestable(), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'typing @ picks a live agent and sends its identity with stable retry',
    (tester) async {
      const agentId = '33333333-3333-4333-8333-333333333333';
      final api = ChatApi()
        ..agentRows = [
          {'id': agentId, 'name': 'Dev Ops'},
          {
            'id': '44444444-4444-4444-8444-444444444444',
            'name': 'Archived',
            'archived_at': '2026-10-01',
          },
        ];
      await openChat(tester, providedApi: api);
      final field = find.byType(TextField);
      await tester.enterText(field, '@');
      await tester.pumpAndSettle();
      expect(find.text('Archived'), findsNothing);
      await tester.tap(find.text('Dev Ops'));
      await tester.pumpAndSettle();
      final controller = tester.widget<TextField>(field).controller!;
      expect(controller.text, '@Dev Ops ');
      controller.value = TextEditingValue(
        text: '${controller.text}check the file',
        selection: const TextSelection.collapsed(offset: 23),
      );
      await tester.pumpAndSettle();
      api.failSend = true;
      await tester.tap(find.byTooltip('发送'));
      await tester.pumpAndSettle();
      expect(api.sent, ['[@Dev Ops](mention://agent/$agentId) check the file']);
      expect(find.byTooltip('重试'), findsOneWidget);
      api.failSend = false;
      await tester.tap(find.byTooltip('重试'));
      await tester.pumpAndSettle();
      expect(api.sent[1], api.sent[0]);
      expect(api.clientIds[1], api.clientIds[0]);
      expect(controller.text, '');
    },
  );

  testWidgets(
    'email does not open agent suggestions and queries filter names',
    (tester) async {
      final api = ChatApi()
        ..agentRows = [
          {'id': '33333333-3333-4333-8333-333333333333', 'name': 'Writer'},
          {'id': '44444444-4444-4444-8444-444444444444', 'name': 'Designer'},
        ];
      await openChat(tester, providedApi: api);
      final field = find.byType(TextField);
      await tester.enterText(field, 'mail@host');
      await tester.pumpAndSettle();
      expect(find.text('Writer'), findsNothing);
      await tester.enterText(field, '@wri');
      await tester.pumpAndSettle();
      expect(find.text('Writer'), findsOneWidget);
      expect(find.text('Designer'), findsNothing);
    },
  );
}
