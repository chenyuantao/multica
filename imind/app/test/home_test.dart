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
  await tester.pumpAndSettle();
}

void main() {
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
}
