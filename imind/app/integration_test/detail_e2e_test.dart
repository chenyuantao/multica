import 'package:flutter/material.dart' hide Flow;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/main.dart';

import 'features_e2e_test.dart' show Flow;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  for (final type in ['note', 'clip', 'recording']) {
    testWidgets('$type detail toolbar, info, inline edit and chat keyboard', (
      tester,
    ) async {
      final f = Flow(tester);
      expect(await f.api.workspaceAgents(), isEmpty);
      final title =
          '详情验收 $type ${DateTime.now().microsecondsSinceEpoch} ${'很长的文件标题' * 8}';
      const body = '详情正文，可以点击编辑';
      final note = await f.api.createNote({
        'share_machine': Flow.machine,
        'type': type,
        'title': title,
        'content': body,
        'transcript': type == 'recording' ? '录音原文，可以点击编辑' : '',
        'tags': ['详情标签'],
        if (type == 'clip') 'source_url': 'https://example.com/detail-test',
      });
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: type == 'recording'
                ? RecordingDetail(api: f.api, machine: Flow.machine, note: note)
                : NoteEditor(api: f.api, machine: Flow.machine, note: note),
          ),
        );
        await tester.pumpAndSettle();
        final heading = find.byKey(const ValueKey('detail-title'));
        final text = tester.widget<Text>(heading);
        expect(text.maxLines, 1);
        expect(text.overflow, TextOverflow.ellipsis);
        expect(
          tester.getTopLeft(heading).dx,
          greaterThan(tester.getTopLeft(find.byTooltip('返回')).dx),
        );
        expect(
          tester.getTopLeft(heading).dy,
          lessThan(tester.getBottomRight(find.byTooltip('返回')).dy),
        );
        expect(find.text('详情标签'), findsNothing);
        expect(find.text('https://example.com/detail-test'), findsNothing);
        expect(find.byTooltip('重命名'), findsNothing);
        expect(find.text('编辑'), findsNothing);
        debugPrint('E2E_DETAIL_CAPTURE: $type-toolbar');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 2)),
        );
        await f.tap(find.byTooltip('更多'));
        for (final label in [
          '编辑',
          '重命名',
          'AI 重命名',
          '标记',
          'AI 标记',
          '文件信息',
          '导出 · 暂不可用',
          '删除',
        ]) {
          expect(find.text(label), findsOneWidget);
        }
        expect(find.byType(PopupMenuDivider), findsNWidgets(3));
        await f.tap(find.text('文件信息'));
        expect(find.text('字数'), findsOneWidget);
        expect(find.text('${body.length}'), findsWidgets);
        expect(find.textContaining('详情标签'), findsOneWidget);
        if (type == 'clip') {
          await tester.scrollUntilVisible(
            find.text('https://example.com/detail-test'),
            150,
            scrollable: find
                .descendant(
                  of: find.byType(BottomSheet),
                  matching: find.byType(Scrollable),
                )
                .first,
          );
          expect(find.text('https://example.com/detail-test'), findsOneWidget);
        }
        debugPrint('E2E_DETAIL_CAPTURE: $type-info');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 2)),
        );
        await f.tap(find.byTooltip('关闭信息'));
        await f.tap(find.byTooltip('更多'));
        await f.tap(find.text('编辑'));
        await f.wait(find.widgetWithText(TextButton, '保存'));
        await f.text(find.byType(TextField).last, '已编辑 $type');
        await f.tap(find.widgetWithText(TextButton, '保存'));
        await f.gone(find.widgetWithText(TextButton, '保存'));
        final saved = await f.api.getNote(Flow.machine, '${note['id']}');
        expect(
          saved[type == 'recording' ? 'transcript' : 'content'],
          '已编辑 $type',
        );
        await f.tap(find.widgetWithText(TextButton, 'AI+'));
        await f.wait(find.text('围绕这份文件开始讨论'));
        final input = find.byType(TextField).last;
        Future<void> keyboard() async {
          await tester.tap(input);
          await SystemChannels.textInput.invokeMethod<void>('TextInput.show');
          await tester.pump(const Duration(seconds: 1));
          expect(tester.widget<TextField>(input).controller, isNotNull);
          expect(
            MediaQuery.viewInsetsOf(tester.element(input)).bottom,
            greaterThan(0),
          );
        }

        Future<void> dismissed() async {
          await tester.pump(const Duration(seconds: 1));
          expect(MediaQuery.viewInsetsOf(tester.element(input)).bottom, 0);
        }

        await keyboard();
        debugPrint('E2E_DETAIL_CAPTURE: $type-keyboard');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 2)),
        );
        await tester.tap(input);
        await tester.pump(const Duration(milliseconds: 300));
        expect(
          MediaQuery.viewInsetsOf(tester.element(input)).bottom,
          greaterThan(0),
        );
        await tester.tap(find.byTooltip('语音输入'));
        final voiceDeadline = DateTime.now().add(const Duration(seconds: 30));
        while (find.text('正在聆听，识别文字将填入输入框').evaluate().isEmpty &&
            DateTime.now().isBefore(voiceDeadline)) {
          await tester.pump(const Duration(milliseconds: 150));
        }
        expect(find.text('正在聆听，识别文字将填入输入框'), findsOneWidget);
        await tester.pump(const Duration(milliseconds: 500));
        expect(
          MediaQuery.viewInsetsOf(tester.element(input)).bottom,
          greaterThan(0),
        );
        await tester.tap(find.byTooltip('停止语音输入'));
        final stopDeadline = DateTime.now().add(const Duration(seconds: 30));
        while (find.byTooltip('语音输入').evaluate().isEmpty &&
            DateTime.now().isBefore(stopDeadline)) {
          await tester.pump(const Duration(milliseconds: 150));
        }
        expect(find.byTooltip('语音输入'), findsOneWidget);
        await tester.pump(const Duration(milliseconds: 500));
        expect(
          MediaQuery.viewInsetsOf(tester.element(input)).bottom,
          greaterThan(0),
        );
        await tester.tap(find.text('AI+ 群聊'));
        await dismissed();
        await keyboard();
        await tester.tap(find.text('围绕这份文件开始讨论'));
        await dismissed();
        await keyboard();
        await tester.enterText(input, '详情键盘验收 $type');
        await tester.tap(find.byTooltip('发送'));
        await dismissed();
        await f.wait(find.text('详情键盘验收 $type'));
        debugPrint(
          'E2E_DETAIL: $type toolbar info inline edit native keyboard passed',
        );
        expect(tester.takeException(), isNull);
        await f.tap(find.byTooltip('关闭'));
      } finally {
        await tester.pumpWidget(const SizedBox());
        final current = await f.api.getNote(Flow.machine, '${note['id']}');
        await f.api.deleteNote(
          '${note['id']}',
          Flow.machine,
          '${current['revision']}',
        );
        f.api.close();
      }
    });
  }
}
