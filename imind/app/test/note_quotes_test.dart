import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/note_quotes.dart';

void main() {
  test('selection restores headings, inline styles, links and code', () {
    final doc = MarkdownSelectionDocument(
      '# 标题\n\n这里有 **加粗文字** 和 [链接](https://example.com)，以及 `x * y`。',
    );
    expect(doc.slice(0, 2), '# 标题');
    final start = doc.plainText.indexOf('加粗');
    final end = doc.plainText.indexOf('，');
    expect(doc.slice(start, end), '**加粗文字** 和 [链接](https://example.com)');
    expect(doc.slice(start + 1, start + 3), '**粗文**');
    final code = doc.plainText.indexOf('x * y');
    expect(doc.slice(code, code + 5), '` x * y `');
  });
  test('cross-block and repeated text keep distinct offsets', () {
    final doc = MarkdownSelectionDocument('**重复**\n\n重复\n\n> 引用\n\n- 项目');
    expect(doc.slice(0, 2), '**重复**');
    final second = doc.plainText.indexOf('重复', 2);
    expect(doc.slice(second, second + 2), '重复');
    expect(doc.slice(0, doc.plainText.length), '**重复**\n\n重复\n\n> 引用\n\n- 项目');
  });
  test('queued quotes compose only on send, deletion and sent anchors are distinct', () {
    final draft = NoteQuoteDraft();
    addTearDown(draft.dispose);
    draft.add(0, 2, '**第一段**', '展开解释');
    draft.add(4, 6, '第二段', '给出案例');
    expect(
      draft.compose('综合比较'),
      '【“**第一段**”+用户指令：“展开解释”】\n\n---------\n\n【“第二段”+用户指令：“给出案例”】\n\n---------\n\n综合比较',
    );
    draft.remove(draft.pending.first);
    expect(draft.pending.single.number, 2);
    draft.markSent(draft.pending);
    expect(draft.pending, isEmpty);
    expect(draft.quotes.single.number, 2);
    expect(draft.compose('下一条'), '下一条');
  });
  test('ordered lists and table selection stay valid Markdown', () {
    final ordered = MarkdownSelectionDocument('3. first\n4. second');
    expect(ordered.slice(0, ordered.plainText.length), '3. first\n4. second');
    final table = MarkdownSelectionDocument(
      '| Name | Value |\n| --- | --- |\n| A | **B** |',
    );
    expect(
      table.slice(0, table.plainText.length),
      '| Name | Value |\n| --- | --- |\n| A | **B** |',
    );
  });
  test(
    'changed content clears stale anchors while same content preserves draft',
    () {
      final draft = NoteQuoteDraft();
      addTearDown(draft.dispose);
      draft.bindSource('original');
      draft.add(0, 1, 'o', 'explain');
      draft.bindSource('original');
      expect(draft.pending.length, 1);
      draft.bindSource('edited');
      expect(draft.quotes, isEmpty);
    },
  );
}
