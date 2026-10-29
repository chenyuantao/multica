import 'dart:math' show max;

import 'package:flutter/material.dart' hide Flow;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/api.dart';

import 'features_e2e_test.dart' show Flow;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'local clip placeholder joins its file chat, retains prompt, retries and reopens',
    (tester) async {
      final f = Flow(tester);
      expect(await f.api.workspaceAgents(), isEmpty);
      await f.start();
      await f.tap(find.byTooltip('更多'));
      await f.tap(find.text('网页剪藏').last);
      final url =
          'https://example.com/clip-${DateTime.now().microsecondsSinceEpoch}';
      final original = '收藏这篇文章：$url。';
      await f.text(find.byType(TextField).first, original);
      await f.text(find.byType(TextField).last, '提取三条结论');
      await f.tap(find.widgetWithText(FilledButton, '剪藏'));
      await f.wait(find.text('AI+ 群聊'));
      await f.wait(find.textContaining('Agent 暂不可用'));
      final notes = await f.api.notes(Flow.machine);
      final clip = notes.singleWhere((n) => n['source_url'] == url);
      final saved = await f.api.getNote(Flow.machine, '${clip['id']}');
      expect(saved['type'], 'clip');
      expect(saved['title'], startsWith('生成中的剪藏'));
      expect(saved['content'], original);
      expect(saved['clip']['original_text'], original);
      expect(saved['clip']['prompt'], '提取三条结论');
      final chat = await f.api.ensureNoteChat(
        Flow.machine,
        '${saved['id']}',
        revision: '${saved['revision']}',
      );
      var history = await f.api.noteChatHistory('${chat['issue_id']}');
      final messages = history['comments'] as List;
      expect(messages, hasLength(1));
      expect(messages.single['content'], contains(url));
      expect(messages.single['content'], contains('提取三条结论'));
      await f.tap(find.text('Agent 暂不可用 · 重试'));
      history = await f.api.noteChatHistory('${chat['issue_id']}');
      expect(history['comments'], hasLength(1));
      final input = find.byType(TextField).last;
      for (final showKeyboard in [false, true]) {
        if (showKeyboard) {
          await tester.tap(input);
          await SystemChannels.textInput.invokeMethod<void>('TextInput.show');
          await tester.pump(const Duration(seconds: 1));
        }
        final media = MediaQuery.of(tester.element(input));
        final inset = max(media.viewInsets.bottom, media.viewPadding.bottom);
        expect(
          tester.getBottomRight(input).dy,
          lessThanOrEqualTo(media.size.height - inset),
        );
        debugPrint(
          'E2E_OPTIMIZATION: composer below-safe-area check keyboard=${media.viewInsets.bottom} safe=${media.viewPadding.bottom}',
        );
      }
      debugPrint('E2E_OPTIMIZATION_CAPTURE: clip chat input safe area');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 2)),
      );
      await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      final again = await f.api.ensureNoteChat(
        Flow.machine,
        '${saved['id']}',
        revision: '${saved['revision']}',
      );
      expect(again['issue_id'], chat['issue_id']);
      debugPrint(
        'E2E_OPTIMIZATION: clip raw text/prompt, same file chat, no-agent retry without duplication passed',
      );
      await tester.pumpWidget(const SizedBox());
      f.api.close();
    },
  );

  testWidgets(
    'local AI naming uses saved file and preserves it when unavailable; recording title is editable',
    (tester) async {
      final f = Flow(tester);
      final title = '命名验收 ${DateTime.now().microsecondsSinceEpoch}';
      var note = await f.api.createNote({
        'share_machine': Flow.machine,
        'type': 'recording',
        'title': title,
        'content': '这份笔记讨论研发计划和本周交付。',
        'transcript': '<!-- transcript: 00:00.000 -->\n先完成开发，再验收两个平台。',
      });
      try {
        note = await f.api.nameNote(
          Flow.machine,
          '${note['id']}',
          '${note['revision']}',
        );
        expect(note['title'], isNotEmpty);
        expect(note['summary'], isNotEmpty);
        debugPrint(
          'E2E_OPTIMIZATION: configured DeepSeek generated title and summary via local service',
        );
      } on ApiException catch (error) {
        if (const bool.fromEnvironment('E2E_NAMING_CONFIGURED')) rethrow;
        expect(error.status, anyOf(502, 503));
        final unchanged = await f.api.getNote(Flow.machine, '${note['id']}');
        expect(unchanged['title'], title);
        expect(unchanged['revision'], note['revision']);
        debugPrint(
          'E2E_OPTIMIZATION: unavailable DeepSeek retained saved filename and revision',
        );
      }
      await tester.pumpWidget(
        MaterialApp(
          home: RecordingDetail(api: f.api, machine: Flow.machine, note: note),
        ),
      );
      await tester.pumpAndSettle();
      await f.tap(find.byTooltip('重命名'));
      await f.text(find.byType(TextField).last, '$title 手改');
      await f.tap(find.widgetWithText(TextButton, '完成'));
      await f.wait(find.text('$title 手改'));
      final saved = await f.api.getNote(Flow.machine, '${note['id']}');
      expect(saved['title'], '$title 手改');
      expect(saved['transcript'], note['transcript']);
      expect(saved['content'], note['content']);
      expect(tester.takeException(), isNull);
      debugPrint(
        'E2E_OPTIMIZATION: recording manual rename preserved transcript and content',
      );
      await tester.pumpWidget(const SizedBox());
      f.api.close();
    },
  );
}
