import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/tag_picker.dart';

class TagApi extends MulticaApi {
  TagApi() : super(baseUrl: 'http://localhost', enableRealtime: false);
  final saved = <String, Map<String, dynamic>>{
    'one': {
      'id': 'one',
      'title': 'One',
      'revision': 'r1',
      'content': 'body',
      'tags': ['A', 'B'],
    },
    'two': {
      'id': 'two',
      'title': 'Two',
      'revision': 'r2',
      'content': 'other',
      'tags': ['A', 'C'],
    },
  };
  final writes = <String>[];
  String? failId;
  @override
  Future<List<Map<String, dynamic>>> notes(
    String machine, {
    String? tag,
  }) async => saved.values.map((n) => Map<String, dynamic>.of(n)).toList();
  @override
  Future<Map<String, dynamic>> getNote(String machine, String id) async =>
      Map.of(saved[id]!);
  @override
  Future<Map<String, dynamic>> updateNote(
    String id,
    Map<String, dynamic> note,
  ) async {
    if (id == failId) throw StateError('offline');
    expect(note['revision'], saved[id]!['revision']);
    writes.add(id);
    return saved[id] = {
      ...saved[id]!,
      ...note,
      'revision': '${note['revision']}+',
    };
  }
}

Future<void> open(WidgetTester tester, TagApi api, {List<String>? ids}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () {
              if (ids == null) {
                manageNoteTags(context, api: api, machine: 'mac');
              } else {
                assignNoteTags(context, api: api, machine: 'mac', noteIds: ids);
              }
            },
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  late TagApi api;
  setUp(() => api = TagApi());
  tearDown(() => api.close());

  testWidgets('assignment toggles and adds only on save, deduplicating names', (
    tester,
  ) async {
    await open(tester, api, ids: ['one']);
    await tester.tap(find.text('A'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('C'));
    await tester.enterText(find.byType(TextField), ' C ');
    await tester.tap(find.text('添加'));
    expect(api.writes, isEmpty);
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    expect(api.saved['one']!['tags'], ['B', 'C']);
    expect(api.saved['one']!['content'], 'body');
    expect(api.writes, ['one']);
  });

  testWidgets('back discards assignment and management drafts', (tester) async {
    await open(tester, api, ids: ['one']);
    await tester.tap(find.text('A'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'draft');
    await tester.tap(find.text('添加'));
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(api.writes, isEmpty);
    await open(tester, api);
    await tester.tap(find.text('A'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('删除标签'));
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(api.writes, isEmpty);
  });

  testWidgets(
    'management rejects duplicates then renames and deletes across notes',
    (tester) async {
      await open(tester, api);
      expect(find.text('新建标签'), findsNothing);
      await tester.tap(find.text('A'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), ' B ');
      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();
      expect(find.text('标签已存在'), findsOneWidget);
      expect(api.writes, isEmpty);
      await tester.enterText(find.byType(TextField), 'D');
      await tester.tap(find.text('修改'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('B'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('删除标签'));
      expect(api.writes, isEmpty);
      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();
      expect(api.saved['one']!['tags'], ['D']);
      expect(api.saved['two']!['tags'], ['D', 'C']);
    },
  );

  testWidgets('batch mixed tags stay per-note while added tags apply to both', (
    tester,
  ) async {
    await open(tester, api, ids: ['one', 'two']);
    await tester.enterText(find.byType(TextField), 'new');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    expect(api.saved['one']!['tags'], ['A', 'B', 'new']);
    expect(api.saved['two']!['tags'], ['A', 'C', 'new']);
  });

  testWidgets(
    'nested management keeps assignment draft and remaps renamed tags',
    (tester) async {
      await open(tester, api, ids: ['one']);
      await tester.tap(find.text('B'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'draft');
      await tester.tap(find.text('添加'));
      await tester.tap(find.text('编辑标签'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('A'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'D');
      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();
      expect(api.saved['one']!['tags'], ['D', 'B']);
      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();
      expect(api.saved['one']!['tags'], ['D', 'draft']);
    },
  );

  test('partial batch retries only remaining writes without reapplying rename chains', () async {
    final notes = await api.notes('mac');
    final batch = TagWrites(api, 'mac');
    List<String> rename(List<String> tags) => [
      for (final t in tags)
        t == 'A'
            ? 'B'
            : t == 'B'
            ? 'D'
            : t,
    ];
    api.failId = 'two';
    await expectLater(batch.save(notes, rename), throwsStateError);
    expect(api.saved['one']!['tags'], ['B', 'D']);
    api.failId = null;
    await batch.save(notes, rename);
    expect(api.writes, ['one', 'two']);
    expect(api.saved['one']!['tags'], ['B', 'D']);
  });

  test('tag updates retain the latest content, transcript and audio', () async {
    final notes = await api.notes('mac');
    api.saved['one'] = {
      ...api.saved['one']!,
      'revision': 'newer',
      'content': 'latest body',
      'transcript': 'latest transcript',
      'audio': {'file': 'audio.wav'},
    };
    await TagWrites(api, 'mac').save(notes, (tags) => [...tags, 'D']);
    expect(api.saved['one']!['content'], 'latest body');
    expect(api.saved['one']!['transcript'], 'latest transcript');
    expect(api.saved['one']!['audio'], {'file': 'audio.wav'});
  });

  test('concurrent tag edits fail before any batch writes', () async {
    final notes = await api.notes('mac');
    api.saved['two'] = {
      ...api.saved['two']!,
      'tags': ['concurrent'],
    };
    await expectLater(
      TagWrites(api, 'mac').save(notes, (_) => ['D']),
      throwsStateError,
    );
    expect(api.writes, isEmpty);
  });
}
