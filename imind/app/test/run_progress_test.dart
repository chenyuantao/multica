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
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is SelectableText &&
              widget.textSpan?.toPlainText() == '先读取文件',
        ),
        findsOneWidget,
      );
      expect(find.text('保存成功'), findsOneWidget);
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
        lessThan(tester.getTopLeft(find.text('保存成功')).dy),
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
