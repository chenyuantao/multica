import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:imind_app/quoted_markdown.dart';
import 'package:imind_app/note_quotes.dart';
import 'package:imind_app/ai_chat.dart';
import 'package:imind_app/main.dart';

import 'ai_chat_test.dart' show ChatApi, noteId;

import 'package:flutter_test/flutter_test.dart';

import 'quote_flow.dart';

class _ApplyApi extends QuoteFlowApi {
  _ApplyApi(this.type);
  final String type;
  Map<String, dynamic> get note => {
    'id': noteId,
    'revision': 'r',
    'type': type,
    'title': '应用修改',
    'content': '**第一段**\n\n第二段',
  };
  @override
  Future<Map<String, dynamic>> getNote(String machine, String id) async => note;
}

void main() {
  testWidgets('selection copy, staged comments and explicit chat send', (
    tester,
  ) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = call.arguments['text'] as String;
        }
        if (call.method == 'Clipboard.getData') return {'text': copied};
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await runQuoteFlow(tester);
  });
  testWidgets(
    'cross-paragraph selection copies Markdown from all selected blocks',
    (tester) async {
      final draft = NoteQuoteDraft();
      addTearDown(draft.dispose);
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied = call.arguments['text'] as String;
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: QuotedMarkdown(
              data: '# 标题\n\n**重复**\n\n重复\n\n[链接](https://example.com)',
              draft: draft,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final region = tester.state<SelectableRegionState>(
        find.byType(SelectableRegion),
      );
      region.selectAll(SelectionChangedCause.toolbar);
      await tester.pumpAndSettle();
      await tester.tap(find.text('复制'));
      await tester.pumpAndSettle();
      expect(copied, '# 标题\n\n**重复**\n\n重复\n\n[链接](https://example.com)');
    },
  );

  testWidgets(
    'failed quoted send retries its snapshot without consuming new quotes',
    (tester) async {
      final api = ChatApi()..failSend = true;
      addTearDown(api.close);
      final draft = NoteQuoteDraft()..add(0, 1, '**A**', '说明');
      addTearDown(draft.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: NoteAiChatSheet(
              api: api,
              machine: 'mbp',
              note: const {'id': noteId, 'revision': 'r'},
              quotes: draft,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('ai-composer-input')),
        '总结',
      );
      final original = draft.compose('总结');
      await tester.tap(find.byTooltip('发送'));
      await tester.pumpAndSettle();
      expect(api.sent, [original]);
      draft.add(2, 3, 'B', '新指令');
      await tester.pumpAndSettle();
      api.failSend = false;
      await tester.tap(find.byTooltip('重试'));
      await tester.pumpAndSettle();
      expect(api.sent, [original, original]);
      expect(api.clientIds[0], api.clientIds[1]);
      expect(draft.pending.single.markdown, 'B');
    },
  );
  for (final type in ['note', 'clip']) {
    testWidgets(
      '$type apply pill opens chat and automatically sends queued suggestions once',
      (tester) async {
        final api = _ApplyApi(type);
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(
            home: NoteEditor(api: api, machine: 'mbp', note: api.note),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('应用'), findsNothing);
        final draft = tester
            .widget<QuotedMarkdown>(find.byType(QuotedMarkdown))
            .draft;
        draft.add(0, 3, '**第一段**', '补充原因');
        draft.add(5, 8, '第二段', '精简措辞');
        await tester.pumpAndSettle();
        final pill = find.byType(ActionPill);
        final labels = tester
            .widgetList<PillButton>(
              find.descendant(of: pill, matching: find.byType(PillButton)),
            )
            .map((b) => b.label);
        expect(labels, ['AI+', '编辑', '应用']);
        expect(api.sent, isEmpty);
        final expected = draft.compose('应用这些修改意见');
        await tester.tap(find.text('应用'));
        await tester.pumpAndSettle();
        expect(find.byType(NoteAiChatSheet), findsOneWidget);
        expect(api.sent, [expected]);
        expect(draft.pending, isEmpty);
        expect(draft.quotes.length, 2);
        await tester.tap(find.byTooltip('关闭'));
        await tester.pumpAndSettle();
        expect(find.text('应用'), findsNothing);
        await tester.tap(find.text('AI+'));
        await tester.pumpAndSettle();
        expect(api.sent, [expected]);
      },
    );
  }
  testWidgets(
    'tap marks to multi-select and delete; only cancel exits deletion mode',
    (tester) async {
      await runMarkDeletionFlow(tester);
    },
  );
  testWidgets(
    'recording note marks have the same cancellable deletion controls',
    (tester) async {
      await runMarkDeletionFlow(tester, recording: true);
    },
  );
}
