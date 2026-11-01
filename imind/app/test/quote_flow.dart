import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/ai_chat.dart';
import 'package:imind_app/quoted_markdown.dart';

import 'ai_chat_test.dart' show ChatApi, noteId;

const article =
    '# 把想法写清楚\n\n**Clarity** makes an idea useful. Start with the reader and keep the next step concrete.\n\nA [reference](https://example.com) gives readers context. Explain why it matters before adding more detail.\n\nKeep the draft small. Review one decision at a time, then turn feedback into the next version.';

class QuoteFlowApi extends ChatApi {
  @override
  Future<Map<String, dynamic>> noteChatHistory(
    String issueId, {
    String? beforeCreatedAt,
    String? beforeId,
    int limit = 50,
  }) async => {'comments': [], 'has_more': false};
}

Future<void> runQuoteFlow(
  WidgetTester tester, {
  Future<void> Function(String)? capture,
}) async {
  final api = QuoteFlowApi();
  addTearDown(api.close);
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1C1C1E)),
      ),
      home: NoteEditor(
        api: api,
        machine: 'mbp',
        note: const {
          'id': noteId,
          'revision': 'r1',
          'type': 'note',
          'title': '把想法写清楚',
          'content': article,
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
  Future<void> shot(String name) async {
    if (capture != null) await capture(name);
  }

  Future<void> select(String word) async {
    final paragraph = find
        .descendant(
          of: find.byType(QuotedMarkdown),
          matching: find.byWidgetPredicate(
            (w) => w is RichText && w.text.toPlainText().contains(word),
          ),
        )
        .first;
    final render = tester.renderObject<RenderParagraph>(paragraph);
    final index = render.text.toPlainText().indexOf(word);
    final boxes = render.getBoxesForSelection(
      TextSelection(baseOffset: index, extentOffset: index + word.length),
    );
    await tester.longPressAt(render.localToGlobal(boxes.first.toRect().center));
    await tester.pumpAndSettle();
    expect(find.text('复制'), findsOneWidget);
    expect(find.text('AI+'), findsWidgets);
  }

  await select('Clarity');
  await shot('01-selection-menu');
  await tester.tap(find.text('复制'));
  await tester.pumpAndSettle();
  final clipboard = await tester.runAsync(
    () => Clipboard.getData(Clipboard.kTextPlain),
  );
  expect(clipboard?.text, '**Clarity**');

  Future<void> comment(
    String word,
    String instruction, {
    bool first = false,
  }) async {
    await select(word);
    await tester.tap(find.text('AI+').last);
    await tester.pumpAndSettle();
    expect(find.text('AI+ 划词评论'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('ai-composer-input')),
      instruction,
    );
    await tester.pumpAndSettle();
    if (first) await shot('02-selection-composer');
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(api.sent, isEmpty);
  }

  // Dismissing the selection composer must not queue a quote or send a message.
  await select('reference');
  await tester.tap(find.text('AI+').last);
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('ai-composer-input')),
    '取消的指令',
  );
  await tester.tapAt(const Offset(12, 100));
  await tester.pumpAndSettle();
  expect(find.text('AI+ 划词评论'), findsNothing);
  expect(
    tester.widget<QuotedMarkdown>(find.byType(QuotedMarkdown)).draft.pending,
    isEmpty,
  );
  expect(api.sent, isEmpty);
  await comment('Clarity', '解释如何让观点更清晰', first: true);
  await comment('reference', '给出一个具体案例');
  final draft = tester
      .widget<QuotedMarkdown>(find.byType(QuotedMarkdown))
      .draft;
  expect(draft.pending.length, 2);
  await comment('draft', '删除这条引用');
  await shot('03-highlighted-quotes');
  await tester.tap(find.text('AI+').last);
  await tester.pumpAndSettle();
  expect(find.byType(NoteAiChatSheet), findsOneWidget);
  expect(find.byKey(const ValueKey('quote-chip-1')), findsOneWidget);
  expect(find.byKey(const ValueKey('quote-chip-2')), findsOneWidget);
  expect(api.sent, isEmpty);
  expect(find.byKey(const ValueKey('quote-chip-3')), findsOneWidget);
  await tester.tap(find.byTooltip('删除引用 3'));
  await tester.pumpAndSettle();
  expect(find.byKey(const ValueKey('quote-chip-3')), findsNothing);
  expect(draft.quotes.length, 2);
  await tester.enterText(
    find.byKey(const ValueKey('ai-composer-input')),
    '结合这两处，给我一份修改建议',
  );
  await tester.pumpAndSettle();
  await shot('04-chat-queued-quotes');
  final expected = draft.compose('结合这两处，给我一份修改建议');
  await tester.tap(find.byTooltip('发送'));
  await tester.pumpAndSettle();
  expect(api.sent, [expected]);
  expect(api.sent.single, contains('**Clarity**'));
  expect(api.sent.single, contains('[reference](https://example.com)'));
  expect(draft.pending, isEmpty);
  expect(draft.quotes.length, 2);
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  await shot('05-chat-sent-message');
  expect(tester.takeException(), isNull);
}

Future<void> runMarkDeletionFlow(
  WidgetTester tester, {
  Future<void> Function(String)? capture,
  bool recording = false,
}) async {
  final api = QuoteFlowApi();
  final note = {
    'id': noteId,
    'revision': 'r',
    'type': recording ? 'recording' : 'note',
    'title': '标记删除',
    'content': '**第一段**\n\n第二段',
  };
  addTearDown(api.close);
  await tester.pumpWidget(
    MaterialApp(
      home: recording
          ? RecordingDetail(api: api, machine: 'mbp', note: note)
          : NoteEditor(api: api, machine: 'mbp', note: note),
    ),
  );
  await tester.pumpAndSettle();
  if (recording) {
    await tester.tap(find.text('笔记'));
    await tester.pumpAndSettle();
  }
  final draft = tester
      .widget<QuotedMarkdown>(find.byType(QuotedMarkdown))
      .draft;
  draft.add(0, 3, '**第一段**', '补充');
  draft.add(4, 7, '第二段', '精简');
  await tester.pumpAndSettle();
  Offset markPoint(String text) {
    final paragraph = find.descendant(
      of: find.byType(QuotedMarkdown),
      matching: find.byWidgetPredicate(
        (w) => w is RichText && w.text.toPlainText() == text,
      ),
    );
    final render = tester.renderObject<RenderParagraph>(paragraph);
    final boxes = render.getBoxesForSelection(
      TextSelection(baseOffset: 0, extentOffset: text.length),
    );
    return render.localToGlobal(boxes.first.toRect().center);
  }

  Future<void> tapMark(String text) async {
    await tester.tapAt(markPoint(text));
    await tester.pumpAndSettle();
  }

  await tapMark('第一段');
  expect(draft.deleting, isTrue);
  expect(draft.selected, {1});
  if (capture != null) await capture('06-single-selected');
  expect(find.text('取消'), findsOneWidget);
  expect(find.text('删除'), findsOneWidget);
  expect(find.byTooltip('返回'), findsNothing);
  expect(find.byTooltip('更多'), findsNothing);
  expect(find.byType(ActionPill), findsNothing);
  expect(
    ModalRoute.of(
      tester.element(find.byType(recording ? RecordingDetail : NoteEditor)),
    )!.popDisposition,
    RoutePopDisposition.doNotPop,
  );
  await tester.longPressAt(markPoint('第二段'));
  await tester.pumpAndSettle();
  expect(find.text('复制'), findsNothing);
  expect(find.text('AI+ 划词评论'), findsNothing);
  await tapMark('第二段');
  expect(draft.selected, {1, 2});
  if (capture != null) await capture('07-multi-selected');
  await tapMark('第二段');
  expect(draft.selected, {1});
  await tester.tap(find.text('删除'));
  await tester.pumpAndSettle();
  expect(draft.quotes.single.number, 2);
  expect(draft.pending.single.number, 2);
  expect(draft.deleting, isTrue);
  expect(draft.selected, isEmpty);
  expect(
    tester.widget<TextButton>(find.widgetWithText(TextButton, '删除')).onPressed,
    isNull,
  );
  expect(find.byType(ActionPill), findsNothing);
  if (capture != null) await capture('08-after-delete');
  await tester.tap(find.text('取消'));
  await tester.pumpAndSettle();
  expect(draft.deleting, isFalse);
  expect(find.byType(ActionPill), findsOneWidget);
  if (!recording) expect(find.text('应用'), findsOneWidget);
  expect(find.byTooltip('返回'), findsOneWidget);
  expect(find.byTooltip('更多'), findsOneWidget);
  expect(api.sent, isEmpty);
}
