import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/input_insets.dart';
import 'package:imind_app/run_progress.dart';

const _issue = '11111111-1111-4111-8111-111111111111';
const _task = '22222222-2222-4222-8222-222222222222';

void main() {
  testWidgets('input uses the larger of keyboard and persistent safe area', (
    tester,
  ) async {
    for (final values in [(0.0, 34.0, 34.0), (300.0, 34.0, 300.0)]) {
      double? result;
      await tester.pumpWidget(
        MediaQuery(
          data: MediaQueryData(
            viewInsets: EdgeInsets.only(bottom: values.$1),
            viewPadding: EdgeInsets.only(bottom: values.$2),
          ),
          child: Builder(
            builder: (context) {
              result = inputBottomInset(context);
              return const SizedBox();
            },
          ),
        ),
      );
      expect(result, values.$3);
    }
  });

  testWidgets(
    'each execution entry starts collapsed and preserves its choice on refresh',
    (tester) async {
      var reads = 0;
      final entries = <Map<String, dynamic>>[
        {
          'task_id': _task,
          'seq': 1,
          'type': 'thinking',
          'content': 'Planning details',
        },
        {
          'task_id': _task,
          'seq': 2,
          'type': 'tool_use',
          'tool': 'Read',
          'input': {'path': '/notes/a.md'},
        },
        {
          'task_id': _task,
          'seq': 3,
          'type': 'tool_result',
          'tool': 'Read',
          'output': 'Full tool output',
          'output_truncated': true,
        },
        {
          'task_id': _task,
          'seq': 4,
          'type': 'text',
          'content': '**Message details**',
        },
        {
          'task_id': _task,
          'seq': 5,
          'type': 'error',
          'content': 'Error details',
        },
      ];
      final api =
          MulticaApi(
              baseUrl: 'http://localhost',
              client: MockClient((request) async {
                final Object data;
                if (request.url.path.endsWith('/task-runs')) {
                  data = [
                    {'id': _task, 'status': 'running'},
                  ];
                } else {
                  reads++;
                  data = entries;
                }
                return http.Response(
                  jsonEncode(data),
                  200,
                  headers: {'content-type': 'application/json; charset=utf-8'},
                );
              }),
            )
            ..token = 'test-token'
            ..workspaceId = _issue;
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: NoteRunProgressPage(
            api: api,
            issueId: _issue,
            initialRun: const {'id': _task, 'status': 'running'},
          ),
        ),
      );
      await tester.pumpAndSettle();
      Finder body(int seq) => find.byKey(ValueKey('run-entry-body-$seq'));
      for (var seq = 1; seq <= 5; seq++) {
        expect(body(seq), findsNothing);
      }
      await tester.tap(find.text('调用工具：Read'));
      await tester.pumpAndSettle();
      expect(body(2), findsOneWidget);
      expect(
        find.descendant(of: body(2), matching: find.byType(SelectableText)),
        findsOneWidget,
      );
      expect(body(1), findsNothing);
      expect(body(3), findsNothing);
      final before = reads;
      entries.add({
        'task_id': _task,
        'seq': 6,
        'type': 'text',
        'content': 'New streaming message',
      });
      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(reads, greaterThan(before));
      expect(body(2), findsOneWidget);
      expect(body(6), findsNothing);
      await tester.tap(find.text('调用工具：Read'));
      await tester.pumpAndSettle();
      expect(body(2), findsNothing);
      for (final (seq, label) in [
        (1, '思考'),
        (3, '工具结果：Read'),
        (4, '回复'),
        (5, '错误'),
      ]) {
        final toggle = find.text(label).first;
        await tester.ensureVisible(toggle);
        await tester.tap(toggle);
        await tester.pumpAndSettle();
        expect(body(seq), findsOneWidget);
        if (seq == 3) expect(find.text('工具输出已截断'), findsOneWidget);
        await tester.tap(toggle);
        await tester.pumpAndSettle();
        expect(body(seq), findsNothing);
      }
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'execution page renders ordered transcript and retries exact-run stop',
    (tester) async {
      final cancelled = <String>[];
      var status = 'running';
      var fail = true;
      final api =
          MulticaApi(
              baseUrl: 'http://localhost',
              client: MockClient((request) async {
                Object data;
                if (request.url.path.endsWith('/cancel')) {
                  cancelled.add(request.url.path);
                  if (fail) {
                    return http.Response('{"error":"unavailable"}', 503);
                  }
                  status = 'cancelled';
                  data = {'status': status};
                } else if (request.url.path.endsWith('/task-runs')) {
                  data = [
                    {'id': _task, 'agent_id': _task, 'status': status},
                  ];
                } else {
                  expect(request.url.path, '/api/tasks/$_task/messages');
                  data = [
                    {
                      'task_id': _task,
                      'seq': 2,
                      'type': 'tool_result',
                      'output': '保存成功',
                      'output_truncated': true,
                    },
                    {
                      'task_id': _task,
                      'seq': 1,
                      'type': 'thinking',
                      'content': '先读取文件',
                    },
                  ];
                }
                return http.Response(
                  jsonEncode(data),
                  200,
                  headers: {'content-type': 'application/json; charset=utf-8'},
                );
              }),
            )
            ..token = 'test-token'
            ..workspaceId = _issue;
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                    builder: (_) => NoteRunProgressPage(
                      api: api,
                      issueId: _issue,
                      initialRun: const {
                        'id': _task,
                        'status': 'running',
                        'agent_name': 'Agent A',
                      },
                    ),
                  ),
                ),
                child: const Text('查看'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('查看'));
      await tester.pumpAndSettle();
      expect(find.text('执行过程'), findsOneWidget);
      expect(find.text('Agent A · 正在处理'), findsOneWidget);
      await tester.tap(find.text('思考'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('工具结果：工具'));
      await tester.pumpAndSettle();
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is SelectableText &&
              widget.textSpan?.toPlainText() == '先读取文件',
        ),
        findsOneWidget,
      );
      expect(find.text('保存成功'), findsWidgets);
      expect(find.text('工具输出已截断'), findsOneWidget);
      expect(
        tester
            .getTopLeft(
              find.byWidgetPredicate(
                (widget) =>
                    widget is SelectableText &&
                    widget.textSpan?.toPlainText() == '先读取文件',
              ),
            )
            .dy,
        lessThan(
          tester.getTopLeft(find.byKey(const ValueKey('run-entry-body-2'))).dy,
        ),
      );
      await tester.tap(find.text('终止'));
      await tester.pumpAndSettle();
      expect(find.textContaining('无法终止运行'), findsOneWidget);
      fail = false;
      await tester.tap(find.text('终止'));
      await tester.pumpAndSettle();
      expect(cancelled, [
        '/api/issues/$_issue/tasks/$_task/cancel',
        '/api/issues/$_issue/tasks/$_task/cancel',
      ]);
      expect(find.text('Agent A · 已取消'), findsOneWidget);
      expect(find.text('终止'), findsNothing);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('查看'), findsOneWidget);
      expect(find.text('执行过程'), findsNothing);
    },
  );
}
