import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/offline_cache.dart';

import 'session_test.dart' show MemorySessionStorage;

const note = <String, dynamic>{
  'id': '22222222-2222-4222-8222-222222222222',
  'title': 'Cached title',
  'content': 'Cached body',
  'revision': 'r1',
  'type': 'note',
};

class ReadApi extends MulticaApi {
  ReadApi()
    : super(
        baseUrl: 'http://note-cache.test',
        enableRealtime: false,
        client: MockClient((_) async => throw StateError('Unexpected request')),
      ) {
    token = 'test';
    workspaceId = '11111111-1111-4111-8111-111111111111';
  }
  bool fail = true;
  Map<String, dynamic>? saved;
  @override
  Future<Map<String, dynamic>> getNote(String machine, String id) async {
    if (fail) throw ApiException(503, 'Read unavailable');
    return {...note, 'title': 'Network title'};
  }

  @override
  Future<List<Map<String, dynamic>>> notes(
    String machine, {
    String? tag,
  }) async {
    if (fail) throw ApiException(503, 'Read unavailable');
    return [];
  }

  @override
  Future<Map<String, dynamic>> createNote(Map<String, dynamic> value) async =>
      saved = {...note, ...value};
  @override
  Future<Map<String, dynamic>> ensureNoteChat(
    String machine,
    String noteId, {
    String? revision,
  }) async => {'issue_id': note['id']};
  @override
  Future<Map<String, dynamic>> getMe() async => {'id': note['id']};
  @override
  Future<List<Map<String, dynamic>>> workspaceAgents() async => [];
  @override
  Future<Map<String, dynamic>> noteChatHistory(
    String issueId, {
    String? beforeCreatedAt,
    String? beforeId,
    int limit = 50,
  }) async => {'comments': <Map<String, dynamic>>[], 'has_more': false};
  @override
  Future<List<Map<String, dynamic>>> noteChatRuns(String issueId) async => [];
}

void main() {
  setUp(() {
    OfflineCache.instance = OfflineCache(storage: MemorySessionStorage());
  });
  testWidgets('cached detail keeps read error and retry restores edit access', (
    tester,
  ) async {
    final api = ReadApi();
    addTearDown(api.close);
    final scope = OfflineCacheScope.capture(api, machine: 'fixture');
    await OfflineCache.instance.write(scope, 'note:${note['id']}', note);
    await tester.pumpWidget(
      MaterialApp(
        home: NoteEditor(api: api, machine: 'fixture', note: note),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Cached body'), findsOneWidget);
    expect(find.text('Read unavailable'), findsOneWidget);
    expect(find.byTooltip('重试同步'), findsOneWidget);
    await tester.tap(find.text('编辑'));
    await tester.pump();
    expect(find.text('正在同步，请联网后重试'), findsOneWidget);
    expect(find.byTooltip('保存'), findsNothing);
    ScaffoldMessenger.of(tester.element(find.byType(NoteEditor)))
        .removeCurrentSnackBar();
    api.fail = false;
    await tester.tap(find.byTooltip('重试同步'));
    await tester.pumpAndSettle();
    expect(find.text('Network title'), findsOneWidget);
    expect(find.text('Read unavailable'), findsNothing);
    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('保存'), findsOneWidget);
  });
  testWidgets('new draft survives read failure and retry before saving', (
    tester,
  ) async {
    final api = ReadApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: NoteEditor(api: api, machine: 'fixture'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Keep my draft');
    await tester.tap(find.byTooltip('保存'));
    await tester.pump();
    expect(api.saved, isNull);
    expect(find.text('正在同步，请联网后重试'), findsOneWidget);
    api.fail = false;
    await tester.tap(find.byTooltip('重试同步'));
    await tester.pumpAndSettle();
    expect(find.text('Keep my draft'), findsOneWidget);
    await tester.tap(find.byTooltip('保存'));
    await tester.pumpAndSettle();
    expect(api.saved?['content'], 'Keep my draft');
    expect(tester.takeException(), isNull);
  });
}
