import 'dart:convert';
import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/session.dart';
import 'package:imind_app/offline_cache.dart';
import 'package:imind_app/note_cache.dart';

const _workspace = '11111111-1111-4111-8111-111111111111';
const _chat = '22222222-2222-4222-8222-222222222222';
const _peer = '44444444-4444-4444-8444-444444444444';
const _user = '33333333-3333-4333-8333-333333333333';

class _Storage implements SessionStorage {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

// Native navigation acceptance uses isolated in-memory data and never sends
// fixture messages to a user's backend or invokes an installed agent.
class _Api extends MulticaApi {
  _Api() : super(baseUrl: 'http://navigation.test', enableRealtime: false);
  final messages = <Map<String, dynamic>>[];
  Completer<void>? listGate, detailGate, historyGate;
  int directCreates = 0, sends = 0;
  String noteTitle = '今天的思考';
  Map<String, dynamic> get note => {
    'id': _chat,
    'title': noteTitle,
    'type': 'note',
    'content': '记录想法',
    'revision': 'r1',
  };
  @override
  Future<Map<String, dynamic>> getNote(String machine, String id) async {
    await detailGate?.future;
    return note;
  }

  @override
  Future<Map<String, dynamic>> openDirectGroupChat({
    required String memberType,
    required String memberId,
  }) async {
    directCreates++;
    return {
      'id': _chat,
      'title': '与同事的会话',
      'is_direct': true,
      'members': [
        {'member_type': 'member', 'member_id': _user},
        {'member_type': memberType, 'member_id': memberId},
      ],
    };
  }

  @override
  Future<List<Map<String, dynamic>>> searchGroupChats(String query) async => [
    {'chat_id': _chat, 'hit_count': 1, 'snippet': '正文检索关键词'},
  ];
  @override
  Future<List<Map<String, dynamic>>> workspaces() async => [
    {'id': _workspace},
  ];
  @override
  Future<List<Map<String, dynamic>>> shares() async => [
    {'machine': 'navigation-fixture'},
  ];
  @override
  Future<void> bootstrap(String machine) async {}
  @override
  Future<List<Map<String, dynamic>>> notes(
    String machine, {
    String? tag,
  }) async {
    await listGate?.future;
    return [note];
  }

  @override
  Future<Map<String, dynamic>> getMe() async => {'id': _user, 'name': '测试用户'};
  @override
  Future<List<Map<String, dynamic>>> workspaceAgents() async => [
    {'id': _workspace, 'name': '笔记助手', 'avatar_url': 'emoji:🤖'},
  ];
  @override
  Future<List<Map<String, dynamic>>> workspaceMembers() async => [
    {'user_id': _user, 'name': '测试用户'},
    {'user_id': _peer, 'name': '同事', 'avatar_url': 'emoji:🦊'},
  ];
  @override
  Future<List<Map<String, dynamic>>> groupChats() async => [
    {
      'id': _chat,
      'title': '项目讨论',
      'description': '一起交流想法',
      'members': <Map<String, dynamic>>[
        {'member_type': 'member', 'member_id': _user},
        {'member_type': 'agent', 'member_id': _workspace},
      ],
      'unread_count': 2,
    },
  ];
  @override
  Future<List<Map<String, dynamic>>> noteChatUnread() async => [];
  @override
  Future<void> markNoteChatRead(String issueId) async {}
  @override
  Future<List<Map<String, dynamic>>> noteChatRuns(String issueId) async => [];
  @override
  Future<Map<String, dynamic>> noteChatHistory(
    String issueId, {
    String? beforeCreatedAt,
    String? beforeId,
    int limit = 50,
  }) async {
    await historyGate?.future;
    return {'comments': messages.toList(), 'has_more': false};
  }

  @override
  Future<Map<String, dynamic>> sendNoteChatMessage(
    String issueId,
    String content, {
    required String clientId,
  }) async {
    sends++;
    final message = <String, dynamic>{
      'id': clientId,
      'issue_id': issueId,
      'author_type': 'member',
      'author_id': _user,
      'content': content,
      'created_at': '2026-11-01T01:00:00Z',
    };
    messages.add(message);
    return message;
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // Notification permission has its own device suite. Keep unrelated system
  // prompts from obscuring this isolated navigation acceptance flow.
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('imind/chat_notifications'),
          (_) async => true,
        );
  });
  final screenshotKey = GlobalKey();
  final screenshots = <String, String>{};
  Future<void> screenshot(WidgetTester tester, String name) async {
    await tester.runAsync(() async {
      final boundary =
          screenshotKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      screenshots[name] = base64Encode(bytes!.buffer.asUint8List());
      image.dispose();
    });
    binding.reportData = {'ui_screenshots': screenshots};
  }

  testWidgets('three tabs, note menu, contacts, chat send and logout', (
    tester,
  ) async {
    final api = _Api();
    OfflineCache.instance = OfflineCache(storage: _Storage());
    final storage = _Storage();
    storage.values[SessionStore.sessionKey] = jsonEncode({
      'base_url': api.baseUrl,
      'token': 'navigation-fixture',
      'workspace_id': _workspace,
      'share_machine': 'navigation-fixture',
    });
    addTearDown(api.close);
    await tester.pumpWidget(
      RepaintBoundary(
        key: screenshotKey,
        child: IMindApp(
          api: api,
          sessionStore: SessionStore(storage: storage),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('今天的思考'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('录音'), findsNothing);
    await screenshot(tester, 'notes');
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    final clip = tester.getCenter(find.text('剪藏'));
    final note = tester.getCenter(find.text('笔记').first);
    final record = tester.getCenter(find.text('录音'));
    final sort = tester.getCenter(find.text('排序方式'));
    expect(clip.dy, lessThan(note.dy));
    expect(note.dy, lessThan(record.dy));
    expect(record.dy, lessThan(sort.dy));
    await screenshot(tester, 'menu');
    await tester.tapAt(const Offset(12, 200));
    await tester.pumpAndSettle();
    await tester.tap(find.text('会话').last);
    await tester.pumpAndSettle();
    expect(find.text('项目讨论'), findsOneWidget);
    await screenshot(tester, 'conversations');
    await tester.tap(find.byTooltip('搜索'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '关键词');
    await tester.pumpAndSettle(const Duration(milliseconds: 300));
    expect(find.text('项目讨论'), findsOneWidget);
    expect(find.textContaining('正文检索关键词'), findsOneWidget);
    await screenshot(tester, 'conversation-search');
    await tester.tap(find.byTooltip('返回'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.menu));
    await tester.pumpAndSettle();
    expect(find.text('智能体'), findsOneWidget);
    expect(find.text('成员'), findsOneWidget);
    expect(find.text('笔记助手'), findsOneWidget);
    await screenshot(tester, 'contacts');
    expect(find.text('同事'), findsOneWidget);
    await tester.tap(find.text('同事'));
    await tester.pumpAndSettle();
    expect(api.directCreates, 1);
    expect(find.text('与同事的会话'), findsOneWidget);
    await tester.tap(find.byTooltip('返回'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('联系人'));
    await tester.pumpAndSettle();
    Navigator.of(tester.element(find.text('智能体'))).pop();
    await tester.pumpAndSettle();
    await tester.tap(find.text('项目讨论'));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.text('AI+ 群聊'), findsNothing);
    await tester.enterText(find.byType(TextField), 'App 页面消息');
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(api.messages.single['content'], 'App 页面消息');
    expect(find.text('App 页面消息'), findsOneWidget);
    await screenshot(tester, 'chat');
    await tester.tap(find.byTooltip('返回'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('我的').last);
    await tester.pumpAndSettle();
    expect(find.text('测试用户'), findsOneWidget);
    expect(find.byType(CircleAvatar), findsOneWidget);
    await screenshot(tester, 'profile');
    await tester.tap(find.byTooltip('退出登录'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('发送验证码'), findsOneWidget);
    expect(storage.values, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'cached note list/detail and chat reject writes until network confirms',
    (tester) async {
      final api = _Api()
        ..token = 'offline-fixture'
        ..workspaceId = _workspace;
      final storage = _Storage();
      final cache = OfflineCache(storage: _Storage());
      OfflineCache.instance = cache;
      final scope = OfflineCacheScope.capture(
        api,
        machine: 'navigation-fixture',
      );
      final stale = {...api.note, 'title': '离线笔记'};
      await cache.write(scope, 'notes-home', {
        'machine': 'navigation-fixture',
        'notes': [stale],
      });
      await cache.write(scope, 'note:$_chat', stale);
      await cache.write(scope, 'conversations', await api.groupChats());
      final cachedMessage = {
        'id': _peer,
        'issue_id': _chat,
        'author_type': 'member',
        'author_id': _peer,
        'content': '缓存消息可检索',
        'created_at': '2026-11-01T01:00:00Z',
      };
      await cache.write(scope, 'chat:$_chat:history', {
        'comments': [cachedMessage],
        'has_more': false,
      });
      api.listGate = Completer<void>();
      api.detailGate = Completer<void>();
      storage.values[SessionStore.sessionKey] = jsonEncode({
        'base_url': api.baseUrl,
        'token': api.token,
        'workspace_id': _workspace,
        'share_machine': 'navigation-fixture',
      });
      addTearDown(api.close);
      await tester.pumpWidget(
        RepaintBoundary(
          key: screenshotKey,
          child: IMindApp(
            api: api,
            sessionStore: SessionStore(storage: storage),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('离线笔记'), findsOneWidget);
      await tester.tap(find.byTooltip('更多'));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.edit_outlined));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('正在同步，请联网后重试'), findsOneWidget);
      expect(find.byType(NoteEditor), findsNothing);
      ScaffoldMessenger.of(tester.element(find.byType(HomePage)))
          .removeCurrentSnackBar();
      // Open the cached detail, which remains readable.
      await tester.pumpAndSettle();
      await tester.tap(find.text('离线笔记'));
      await tester.pumpAndSettle();
      expect(find.byType(NoteEditor), findsOneWidget);
      for (final action in ['重命名', '标记', '删除']) {
        await tester.tap(find.byTooltip('更多'));
        await tester.pumpAndSettle();
        await tester.tap(find.text(action));
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('正在同步，请联网后重试'), findsOneWidget);
        expect(find.byType(AlertDialog), findsNothing);
        ScaffoldMessenger.of(tester.element(find.byType(NoteEditor)))
            .removeCurrentSnackBar();
        await tester.pumpAndSettle();
      }
      await tester.tap(find.text('编辑'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('正在同步，请联网后重试'), findsOneWidget);
      expect(find.byTooltip('保存'), findsNothing);
      await screenshot(tester, 'offline-note-detail');
      ScaffoldMessenger.of(tester.element(find.byType(NoteEditor)))
          .removeCurrentSnackBar();
      api.detailGate!.complete();
      await tester.pumpAndSettle();
      expect(find.text('今天的思考'), findsOneWidget);
      await tester.tap(find.text('编辑'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('保存'), findsOneWidget);
      await tester.tap(find.byTooltip('放弃'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('返回'));
      api.listGate!.complete();
      await tester.pumpAndSettle();
      expect(find.text('今天的思考'), findsOneWidget);
      api.historyGate = Completer<void>();
      await tester.tap(find.text('会话').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('项目讨论'));
      await tester.pumpAndSettle();
      expect(find.text('缓存消息可检索'), findsOneWidget);
      await tester.enterText(find.byType(TextField), '等待网络确认');
      await tester.tap(find.byTooltip('发送'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(api.sends, 0);
      expect(find.text('正在同步，请联网后重试'), findsOneWidget);
      await screenshot(tester, 'offline-chat-detail');
      api.historyGate!.complete();
      await tester.pumpAndSettle();
      expect(find.text('缓存消息可检索'), findsNothing);
      await tester.tap(find.byTooltip('发送'));
      await tester.pumpAndSettle();
      expect(api.sends, 1);
      expect(find.text('等待网络确认'), findsOneWidget);
      final persisted = decodeCachedNote(
        await cache.read(scope, 'note:$_chat'),
      );
      expect(persisted['title'], '今天的思考');
      expect(tester.takeException(), isNull);
    },
  );
}
