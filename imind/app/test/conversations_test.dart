import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/conversations.dart';
import 'package:imind_app/conversation_avatar.dart';
import 'package:imind_app/offline_cache.dart';
import 'package:imind_app/session.dart';

const chatId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const agentId = '33333333-3333-4333-8333-333333333333';

class ConversationsApi extends MulticaApi {
  ConversationsApi() : super(baseUrl: 'http://localhost');

  int groupChatRequests = 0;
  int contactRequests = 0;
  int profileRequests = 0;

  @override
  Future<Map<String, dynamic>> getMe() async {
    profileRequests++;
    return {'id': memberId, 'name': 'Lee'};
  }

  @override
  Future<List<Map<String, dynamic>>> groupChats() async {
    groupChatRequests++;
    return [
      {
        'id': chatId,
        'title': 'Product planning',
        'members': [],
        'last_message': {'content': 'Next steps'},
        'last_comment_at': DateTime.now().toIso8601String(),
        'unread_count': 2,
      },
    ];
  }

  @override
  Future<List<Map<String, dynamic>>> workspaceAgents() async {
    contactRequests++;
    return [
      {'id': agentId, 'name': 'Helper'},
    ];
  }

  @override
  Future<List<Map<String, dynamic>>> workspaceMembers() async {
    contactRequests++;
    return [
      {'user_id': memberId, 'name': 'Lee'},
    ];
  }
}

class MemoryStorage implements SessionStorage {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

class InteractiveApi extends ConversationsApi {
  InteractiveApi({this.direct = false});
  final bool direct;
  int opens = 0;
  String? searchQuery;
  @override
  Future<List<Map<String, dynamic>>> groupChats() async => [
    {
      'id': chatId,
      'title': 'Product planning',
      'is_direct': direct,
      'members': [
        {'member_type': 'member', 'member_id': memberId},
        {'member_type': 'agent', 'member_id': agentId},
      ],
    },
  ];
  @override
  Future<List<Map<String, dynamic>>> workspaceAgents() async => [
    {'id': agentId, 'name': 'Helper', 'avatar_url': 'emoji:🤖'},
  ];
  @override
  Future<Map<String, dynamic>> openDirectGroupChat({
    required String memberType,
    required String memberId,
  }) async {
    opens++;
    return {'id': chatId, 'title': 'Helper', 'members': []};
  }

  @override
  Future<List<Map<String, dynamic>>> searchGroupChats(String q) async {
    searchQuery = q;
    return [
      {
        'chat_id': chatId,
        'message_id': memberId,
        'snippet': 'server result',
        'hit_count': 1,
      },
    ];
  }

  @override
  Future<Map<String, dynamic>> noteChatHistory(
    String issueId, {
    String? beforeCreatedAt,
    String? beforeId,
    int limit = 50,
  }) async => {'comments': <Map<String, dynamic>>[], 'has_more': false};
  @override
  Future<List<Map<String, dynamic>>> noteChatRuns(String issueId) async => [];
  @override
  Future<void> markNoteChatRead(String issueId) async {}
}

class PendingListApi extends InteractiveApi {
  final pending = Completer<List<Map<String, dynamic>>>();
  @override
  Future<List<Map<String, dynamic>>> groupChats() => pending.future;
}

void main() {
  testWidgets(
    'cached contacts cannot start conversations until list network confirms',
    (tester) async {
      final api = PendingListApi();
      addTearDown(api.close);
      OfflineCache.instance = OfflineCache(storage: MemoryStorage());
      await OfflineCache.instance.write(
        OfflineCacheScope.capture(api, machine: ''),
        'conversations',
        [
          {'id': chatId, 'title': 'Cached chat', 'members': []},
        ],
      );
      await tester.pumpWidget(
        MaterialApp(home: ConversationsPage(api: api, machine: null)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Cached chat'), findsOneWidget);
      await tester.tap(find.byTooltip('联系人'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Helper'));
      await tester.pumpAndSettle();
      expect(api.opens, 0);
      expect(find.text('正在同步，请联网后重试'), findsOneWidget);
      api.pending.complete([]);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Helper'));
      await tester.pumpAndSettle();
      expect(api.opens, 1);
      expect(find.byTooltip('返回'), findsOneWidget);
    },
  );

  setUp(() => OfflineCache.instance = OfflineCache(storage: MemoryStorage()));

  for (final existing in [false, true]) {
    testWidgets(
      'contact avatar and direct chat ${existing ? 'reuse' : 'creation'}',
      (tester) async {
        final api = InteractiveApi(direct: existing);
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(home: ConversationsPage(api: api, machine: null)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('联系人'));
        await tester.pumpAndSettle();
        expect(find.byType(ConversationActorAvatar), findsWidgets);
        expect(find.text('🤖'), findsWidgets);
        await tester.tap(find.text('Helper'));
        await tester.pumpAndSettle();
        expect(find.byTooltip('返回'), findsOneWidget);
        expect(api.opens, existing ? 0 : 1);
        expect(
          find.text(existing ? 'Product planning' : 'Helper'),
          findsOneWidget,
        );
      },
    );
  }

  testWidgets(
    'inline search renders cached message content then network snippet',
    (tester) async {
      final api = InteractiveApi();
      addTearDown(api.close);
      await OfflineCache.instance.write(
        OfflineCacheScope.capture(api, machine: ''),
        'chat:$chatId:history',
        {
          'comments': [
            {'content': 'secret cached message'},
          ],
          'has_more': false,
        },
      );
      await tester.pumpWidget(
        MaterialApp(home: ConversationsPage(api: api, machine: null)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('搜索'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'secret');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('secret cached message'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 150));
      await tester.pumpAndSettle();
      expect(api.searchQuery, 'secret');
      expect(find.text('server result'), findsOneWidget);
      expect(find.text('secret cached message'), findsNothing);
      await tester.tap(find.byTooltip('返回'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('搜索'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    },
  );

  testWidgets(
    'shows joined conversations and loads only agent and member contacts on demand',
    (tester) async {
      final api = ConversationsApi();
      addTearDown(api.close);

      await tester.pumpWidget(
        MaterialApp(home: ConversationsPage(api: api, machine: null)),
      );
      await tester.pumpAndSettle();

      expect(find.text('Product planning'), findsOneWidget);
      expect(find.text('Next steps'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(
        tester
            .getSize(
              find
                  .ancestor(
                    of: find.text('2'),
                    matching: find.byType(Container),
                  )
                  .first,
            )
            .width,
        lessThan(40),
      );
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is Text &&
              RegExp(r'^\d{2}:\d{2}$').hasMatch(widget.data ?? ''),
        ),
        findsOneWidget,
      );
      expect(api.groupChatRequests, 1);
      expect(api.contactRequests, 2);
      expect(api.profileRequests, 1);

      await tester.tap(find.byTooltip('联系人'));
      await tester.pumpAndSettle();

      expect(find.text('智能体'), findsOneWidget);
      expect(find.text('Helper'), findsOneWidget);
      expect(find.text('成员'), findsOneWidget);
      expect(find.text('Lee'), findsNothing);
      expect(find.text('新建会话'), findsNothing);
      expect(api.contactRequests, 4);
    },
  );
}
