import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/session.dart';

import 'session_test.dart' show MemorySessionStorage;

const workspace = '11111111-1111-4111-8111-111111111111';
const firstId = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';

Future<void> pumpHome(
  WidgetTester tester,
  List<Map<String, dynamic>> notes, {
  Future<void> Function()? onList,
  bool settle = true,
}) async {
  final storage = MemorySessionStorage();
  storage.values[SessionStore.sessionKey] = jsonEncode({
    'base_url': 'http://localhost',
    'token': 'test',
    'workspace_id': workspace,
    'share_machine': 'mbp',
  });
  final api = MulticaApi(
    baseUrl: 'http://localhost',
    enableRealtime: false,
    client: MockClient((request) async {
      if (request.url.path == '/api/imind/notes/list') await onList?.call();
      final Object result = switch (request.url.path) {
        '/api/workspaces' => [
          {'id': workspace},
        ],
        '/api/imind/shares' => {
          'shares': [
            {'machine': 'mbp'},
          ],
        },
        '/api/imind/notes/list' => {'notes': notes},
        _ => <String, dynamic>{},
      };
      return http.Response(
        jsonEncode(result),
        200,
        headers: {'content-type': 'application/json'},
      );
    }),
  );
  addTearDown(api.close);
  await tester.pumpWidget(
    IMindApp(
      api: api,
      sessionStore: SessionStore(storage: storage),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }
}

void main() {
  testWidgets('generating items fade until polling receives a body', (
    tester,
  ) async {
    var calls = 0;
    final notes = <Map<String, dynamic>>[
      {
        'id': firstId,
        'title': 'Generating',
        'revision': 'r',
        'type': 'recording',
        'content': '  ',
      },
      {
        'id': secondId,
        'title': 'Empty note',
        'revision': 'r',
        'type': 'note',
        'content': '',
      },
    ];
    await pumpHome(
      tester,
      notes,
      settle: false,
      onList: () async {
        calls++;
      },
    );
    Finder fadeFor(String title) => find
        .ancestor(of: find.text(title), matching: find.byType(FadeTransition))
        .first;
    double opacity(String title) =>
        tester.widget<FadeTransition>(fadeFor(title)).opacity.value;

    final initial = opacity('Generating');
    await tester.pump(const Duration(milliseconds: 400));
    expect(opacity('Generating'), isNot(initial));
    expect(opacity('Empty note'), 1);
    notes[0]['content'] = 'Completed body';
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(opacity('Generating'), 1);
    final completedCalls = calls;
    await tester.pump(const Duration(seconds: 6));
    expect(calls, completedCalls);
  });

  testWidgets('tag filters combine with OR and clear together', (tester) async {
    await pumpHome(tester, [
      {
        'id': firstId,
        'revision': 'r',
        'title': 'First',
        'type': 'note',
        'tags': ['one'],
      },
      {
        'id': secondId,
        'revision': 'r',
        'title': 'Second',
        'type': 'note',
        'tags': ['two'],
      },
    ]);
    await tester.tap(find.text('#one'));
    await tester.pumpAndSettle();
    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsNothing);
    await tester.tap(find.text('#two'));
    await tester.pumpAndSettle();
    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(find.text('取消'), findsNothing);
    expect(find.text('Second'), findsOneWidget);
    expect(find.text('剪藏'), findsOneWidget);
  });

  testWidgets('empty home refresh waits for the list request', (tester) async {
    var calls = 0;
    final pending = Completer<void>();
    await pumpHome(
      tester,
      [],
      onList: () async {
        calls++;
        if (calls > 1) await pending.future;
      },
    );
    await tester.drag(find.byType(RefreshIndicator), const Offset(0, 400));
    for (var i = 0; i < 10 && calls < 2; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(calls, 2);
    expect(find.byType(RefreshProgressIndicator), findsOneWidget);
    pending.complete();
    await tester.pumpAndSettle();
    expect(find.byType(RefreshProgressIndicator), findsNothing);
  });

  testWidgets('sidebar tag edit opens the unified management page', (
    tester,
  ) async {
    await pumpHome(tester, [
      {
        'id': firstId,
        'revision': 'r',
        'title': 'First',
        'type': 'note',
        'tags': ['Work'],
      },
    ]);
    tester.state<ScaffoldState>(find.byType(Scaffold).last).openDrawer();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byTooltip('编辑标签'));
    await tester.tap(find.byTooltip('编辑标签'));
    await tester.pumpAndSettle();
    expect(find.text('标签管理'), findsOneWidget);
    expect(find.text('Work'), findsOneWidget);
    expect(find.text('新建标签'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('First'), findsOneWidget);
  });

  testWidgets('long press exposes manual and AI tagging', (tester) async {
    await pumpHome(tester, [
      {'id': firstId, 'revision': 'r', 'title': 'First', 'type': 'note'},
    ]);
    await tester.longPress(find.text('First'));
    await tester.pumpAndSettle();
    expect(find.text('标记'), findsOneWidget);
    expect(find.text('AI 标记'), findsOneWidget);
    await tester.tap(find.text('标记'));
    await tester.pumpAndSettle();
    expect(find.text('新建标签'), findsOneWidget);
  });
  for (final entry in <String, List<String>>{
    '创建时间 · 倒序': ['Third', 'First', 'Second'],
    '创建时间 · 正序': ['Second', 'First', 'Third'],
    '更新时间 · 倒序': ['Second', 'Third', 'First'],
    '更新时间 · 正序': ['First', 'Third', 'Second'],
  }.entries) {
    testWidgets('sort menu orders by ${entry.key}', (tester) async {
      await pumpHome(tester, [
        {
          'id': firstId,
          'revision': 'r',
          'title': 'First',
          'type': 'note',
          'created_at': '2026-10-02T00:00:00Z',
          'updated_at': '2026-10-01T08:00:00+08:00',
        },
        {
          'id': secondId,
          'revision': 'r',
          'title': 'Second',
          'type': 'note',
          'created_at': '2026-10-01T00:00:00Z',
          'updated_at': '2026-10-03T00:00:00Z',
        },
        {
          'id': '44444444-4444-4444-8444-444444444444',
          'revision': 'r',
          'title': 'Third',
          'type': 'note',
          'created_at': '2026-10-03T00:00:00Z',
          'updated_at': '2026-10-02T00:00:00Z',
        },
      ]);
      await tester.tap(find.byTooltip('更多'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('排序方式'));
      await tester.pumpAndSettle();
      await tester.tap(find.text(entry.key));
      await tester.pumpAndSettle();
      final positions = [
        for (final title in entry.value) tester.getTopLeft(find.text(title)).dy,
      ];
      expect(positions[0], lessThan(positions[1]));
      expect(positions[1], lessThan(positions[2]));
    });
  }

  testWidgets(
    'search debounces, matches titles or bodies, and clears on back',
    (tester) async {
      var lists = 0;
      await pumpHome(
        tester,
        [
          {
            'id': firstId,
            'revision': 'r',
            'title': 'Alpha Guide',
            'type': 'note',
            'content': 'ordinary body',
          },
          {
            'id': secondId,
            'revision': 'r',
            'title': 'Second',
            'type': 'note',
            'content': 'A Needle in the body',
          },
        ],
        onList: () async {
          lists++;
        },
      );
      await tester.tap(find.byTooltip('搜索'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('返回'), findsOneWidget);
      expect(find.byTooltip('菜单'), findsNothing);
      final input = find.byType(TextField);
      await tester.enterText(input, 'Need');
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('Alpha Guide'), findsOneWidget);
      await tester.enterText(input, 'needle');
      await tester.pump(const Duration(milliseconds: 299));
      expect(find.text('Alpha Guide'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 1));
      expect(find.text('Alpha Guide'), findsNothing);
      expect(find.text('Second'), findsOneWidget);
      await tester.enterText(input, 'ALPHA');
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Alpha Guide'), findsOneWidget);
      expect(find.text('Second'), findsNothing);
      await tester.enterText(input, '');
      await tester.pump();
      expect(find.text('Second'), findsOneWidget);
      await tester.enterText(input, 'missing');
      await tester.tap(find.byTooltip('返回'));
      await tester.pumpAndSettle();
      expect(find.byType(TextField), findsNothing);
      expect(find.byTooltip('菜单'), findsOneWidget);
      expect(find.text('Alpha Guide'), findsOneWidget);
      expect(find.text('Second'), findsOneWidget);
      expect(lists, 1);
    },
  );
  testWidgets(
    'search preserves tag filters and system back restores the phone header',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      await pumpHome(tester, [
        {
          'id': firstId,
          'revision': 'r',
          'title': 'First',
          'type': 'note',
          'content': 'target',
          'tags': ['one'],
        },
        {
          'id': secondId,
          'revision': 'r',
          'title': 'Second',
          'type': 'note',
          'content': 'target',
          'tags': ['two'],
        },
        {
          'id': '44444444-4444-4444-8444-444444444444',
          'revision': 'r',
          'title': 'Third',
          'type': 'note',
          'content': 'other',
          'tags': ['one'],
        },
      ]);
      await tester.tap(find.text('#one'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('搜索'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'target');
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('First'), findsOneWidget);
      expect(find.text('Second'), findsNothing);
      expect(find.text('Third'), findsNothing);
      await tester.enterText(find.byType(TextField), '');
      await tester.pump();
      expect(find.text('Third'), findsOneWidget);
      expect(find.text('Second'), findsNothing);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(TextField), findsNothing);
      expect(find.byTooltip('菜单'), findsOneWidget);
      expect(find.text('Second'), findsNothing);
      expect(find.text('First'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
