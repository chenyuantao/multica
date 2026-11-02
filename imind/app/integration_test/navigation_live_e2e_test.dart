import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:imind_app/api.dart';
import 'package:imind_app/ai_chat.dart';
import 'package:imind_app/conversation_avatar.dart';
import 'package:imind_app/conversations.dart';
import 'package:imind_app/offline_cache.dart';
import 'package:integration_test/integration_test.dart';

/// Gates real history requests without substituting any backend response.
class _HistoryGateClient extends http.BaseClient {
  final _inner = http.Client();
  Completer<void>? historyGate;
  int historyRequests = 0;
  int historyResponses = 0;
  int messageSends = 0;
  int messageResponses = 0;
  int listResponses = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final history =
        request.method == 'GET' && request.url.path.endsWith('/comments/page');
    if (history) {
      historyRequests++;
      await historyGate?.future;
    }
    final sending =
        request.method == 'POST' && request.url.path.endsWith('/comments');
    final listing =
        request.method == 'GET' && request.url.path == '/api/group-chats';
    if (sending) {
      messageSends++;
    }
    final response = await _inner.send(request);
    if (!history && !sending && !listing) return response;
    final buffered = await http.Response.fromStream(response);
    if (history) historyResponses++;
    if (sending) messageResponses++;
    if (listing) listResponses++;
    return http.StreamedResponse(
      Stream.value(buffered.bodyBytes),
      buffered.statusCode,
      headers: buffered.headers,
      request: request,
    );
  }

  @override
  void close() => _inner.close();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'live contacts, native send, content search and secure offline cache',
    (tester) async {
      final client = _HistoryGateClient();
      final api =
          MulticaApi(
              baseUrl: defaultApiBase(),
              client: client,
              enableRealtime: false,
            )
            ..token = const String.fromEnvironment('E2E_TOKEN')
            ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
      const machine = String.fromEnvironment('E2E_MACHINE');
      addTearDown(api.close);
      Future<T> real<T>(Future<T> Function() action) async =>
          (await tester.runAsync(action)) as T;
      Future<void> waitUntil(bool Function() ready, String reason) async {
        for (var i = 0; i < 300; i++) {
          await tester.pump(const Duration(milliseconds: 100));
          if (ready()) return;
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 50)),
          );
        }
        expect(ready(), isTrue, reason: reason);
      }

      Future<void> waitFor(Finder finder) =>
          waitUntil(() => finder.evaluate().isNotEmpty, 'Missing $finder');
      Future<void> capture(String name) async {
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pump(const Duration(milliseconds: 400));
        debugPrint('E2E_NAVIGATION_CAPTURE: $name');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 2)),
        );
      }

      final workspaces = await real(api.workspaces);
      expect(
        workspaces.any(
          (ws) =>
              ws['id'] == api.workspaceId && ws['slug'] == 'imind-validation',
        ),
        isTrue,
        reason: 'Live navigation acceptance requires the dedicated imind-validation workspace',
      );
      expect(
        await real(api.workspaceAgents),
        isEmpty,
        reason: 'This suite must never dispatch an installed agent CLI',
      );
      final me = await real(api.getMe);
      final members = await real(api.workspaceMembers);
      final peers = members.where(
        (m) => m['name'] == 'iMind device peer' && m['user_id'] != me['id'],
      );
      expect(
        peers,
        isNotEmpty,
        reason: 'Create the dedicated iMind device peer fixture before running navigation acceptance',
      );
      final peer = peers.first;
      final peerId = peer['user_id'] as String;
      final chat = await real(
        () => api.openDirectGroupChat(memberType: 'member', memberId: peerId),
      );
      final reopened = await real(
        () => api.openDirectGroupChat(memberType: 'member', memberId: peerId),
      );
      expect(
        reopened['id'],
        chat['id'],
        reason: 'Direct-chat endpoint must reuse the existing conversation',
      );
      final chatId = chat['id'] as String;
      expect(chat['is_direct'], isTrue);
      expect((chat['members'] as List).length, 2);
      final message =
          'Native navigation content ${DateTime.now().microsecondsSinceEpoch}';
      final blocked = 'Must remain an unsent offline draft';
      final scope = OfflineCacheScope.capture(api, machine: machine);
      final cache = OfflineCache();
      OfflineCache.instance = cache;
      String? sentId;
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: ConversationsPage(api: api, machine: machine),
          ),
        );
        await waitFor(find.byTooltip('联系人'));
        // Wait for the real list instead of relying on an older secure cache entry.
        await waitUntil(
          () => client.listResponses > 0,
          'Conversation list did not load',
        );
        await tester.tap(find.byTooltip('联系人'));
        final peerTile = find.byWidgetPredicate(
          (widget) =>
              widget is ListTile &&
              widget.leading is ConversationActorAvatar &&
              (widget.leading as ConversationActorAvatar).actor.id == peerId,
        );
        await waitFor(peerTile);
        await capture('live-contacts');
        await tester.tap(peerTile);
        final composer = find.byKey(const ValueKey('ai-composer-input'));
        await waitFor(composer.hitTestable());
        await waitUntil(
          () => client.historyResponses >= 2,
          'Initial history and follow-up real synchronization did not finish',
        );
        await tester.pump(const Duration(milliseconds: 300));
        await tester.enterText(composer, message);
        await tester.tap(find.byTooltip('发送'));
        await waitUntil(
          () => client.messageSends == 1 && client.messageResponses == 1,
          'Native composer did not send',
        );
        final page = await real(() => api.noteChatHistory(chatId));
        final sent = (page['comments'] as List)
            .whereType<Map<String, dynamic>>()
            .where((m) => m['content'] == message)
            .toList();
        expect(
          sent,
          hasLength(1),
          reason: 'Native message must persist once in the real API',
        );
        sentId = sent.single['id'] as String;
        await waitFor(find.text(message, findRichText: true));
        await capture('live-message');
        // Reread the app's automatic write through a fresh cache instance.
        // Never seed the sent message from the test: that would hide a broken
        // application persistence path.
        Object? stored;
        for (var attempt = 0; attempt < 60; attempt++) {
          stored = await real(
            () => OfflineCache().read(scope, 'chat:$chatId:history'),
          );
          if (stored is Map &&
              stored['comments'] is List &&
              (stored['comments'] as List).any(
                (value) => value is Map && value['content'] == message,
              )) {
            break;
          }
          await tester.pump(const Duration(milliseconds: 100));
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 50)),
          );
        }
        expect(stored, isA<Map>());
        expect(
          (stored as Map)['comments'],
          contains(
            predicate(
              (Object? value) => value is Map && value['content'] == message,
            ),
          ),
        );
        await tester.tap(find.byTooltip('返回'));
        await waitFor(find.byTooltip('搜索').hitTestable());
        await tester.pumpAndSettle();
        expect(find.byType(ConversationChatPage), findsNothing);
        await tester.tap(find.byTooltip('搜索').hitTestable());
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), message);
        final searchSnippet = find
            .byWidgetPredicate(
              (widget) => widget is Text && widget.data == message,
            )
            .hitTestable();
        await waitFor(searchSnippet);
        expect(find.byType(ConversationChatPage), findsNothing);
        final hits = await real(() => api.searchGroupChats(message));
        expect(
          hits.any((hit) => hit['chat_id'] == chatId),
          isTrue,
          reason: 'Existing network IM search must include message content',
        );
        await capture('live-search');
        final beforeGate = client.historyRequests;
        client.historyGate = Completer<void>();
        await tester.tap(searchSnippet);
        await waitUntil(
          () => client.historyRequests > beforeGate,
          'Reopened chat did not request real network history',
        );
        await waitFor(composer.hitTestable());
        await waitFor(find.text(message, findRichText: true));
        final beforeBlockedSend = client.messageSends;
        await tester.enterText(composer, blocked);
        await tester.tap(find.byTooltip('发送'));
        await waitFor(find.text('正在同步，请联网后重试'));
        expect(
          client.messageSends,
          beforeBlockedSend,
          reason: 'Cached history must never unlock sends before network confirmation',
        );
        expect(tester.widget<TextField>(composer).controller!.text, blocked);
        await capture('live-cached-send-blocked');
        final previousResponses = client.historyResponses;
        client.historyGate!.complete();
        client.historyGate = null;
        await waitUntil(
          () => client.historyResponses >= previousResponses + 2,
          'Real history did not replace the cached read',
        );
        expect(tester.widget<TextField>(composer).controller!.text, blocked);
        expect(client.messageSends, beforeBlockedSend);
        debugPrint(
          'E2E_NAVIGATION: real API direct-chat reuse, native send, content search, secure-storage reopen and offline mutation interception passed',
        );
      } finally {
        client.historyGate?.complete();
        client.historyGate = null;
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
        // The only created content is a uniquely named message in the dedicated
        // peer chat. Remove it even when a later UI assertion fails.
        await real(() async {
          final cleanupClient = http.Client();
          try {
            if (sentId == null) {
              final page = await api.noteChatHistory(chatId);
              for (final entry in (page['comments'] as List).whereType<Map>()) {
                if (entry['content'] == message) sentId = entry['id'] as String;
              }
            }
            if (sentId != null) {
              final response = await cleanupClient.delete(
                Uri.parse('${api.baseUrl}/api/comments/$sentId'),
                headers: {
                  'Authorization': 'Bearer ${api.token}',
                  'X-Workspace-ID': api.workspaceId!,
                },
              );
              expect(
                response.statusCode,
                inInclusiveRange(200, 299),
                reason: 'Dedicated acceptance message cleanup failed',
              );
              debugPrint(
                'E2E_NAVIGATION: temporary message deleted; dedicated direct peer chat retained',
              );
            }
            final remaining = await api.noteChatHistory(chatId);
            await cache.write(scope, 'chat:$chatId:history', remaining);
            await cache.write(scope, 'conversations', await api.groupChats());
          } finally {
            cleanupClient.close();
          }
        });
      }
    },
  );
}
