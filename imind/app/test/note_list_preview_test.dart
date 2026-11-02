import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/chat_time.dart';
import 'package:imind_app/note_list_preview.dart';

void main() {
  Future<void> pumpPreview(
    WidgetTester tester,
    Map<String, dynamic> note, {
    int unread = 0,
  }) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 300,
            child: NoteListPreview(
              note: note,
              unreadBadge: unread > 0 ? Text('$unread') : null,
            ),
          ),
        ),
      ),
    ),
  );

  testWidgets(
    'keeps category, tags and author on the second line with time on the right',
    (tester) async {
      final title = '这是一条非常长的笔记标题' * 10;
      final tags = ['很长的标签' * 20, '第二个标签'];
      final author = '很长的作者名称' * 20;
      final updated = DateTime.now().toUtc().toIso8601String();
      await pumpPreview(tester, {
        'title': title,
        'type': 'clip',
        'summary': '不显示摘要',
        'updated_at': updated,
        'author': author,
        'tags': tags,
        'iconUrl': 'https://example.test/icon.png',
      }, unread: 3);

      final titleFinder = find.text(title);
      final tagsFinder = find.text(tags.map((tag) => '#$tag').join(' '));
      final authorFinder = find.text(author);
      final categoryFinder = find.text('剪藏');
      for (final finder in [titleFinder, tagsFinder, authorFinder]) {
        final text = tester.widget<Text>(finder);
        expect(text.maxLines, 1);
        expect(text.overflow, TextOverflow.ellipsis);
      }
      final time = find.text(chatTimeLabel(updated));
      expect(
        tester.getRect(time).left,
        greaterThan(tester.getRect(titleFinder).right),
      );
      expect(
        tester.getRect(categoryFinder).top,
        greaterThan(tester.getRect(titleFinder).bottom),
      );
      expect(
        tester.getRect(tagsFinder).top,
        tester.getRect(categoryFinder).top,
      );
      expect(
        tester.getRect(authorFinder).top,
        tester.getRect(categoryFinder).top,
      );
      expect(tester.getSize(authorFinder).width, greaterThan(0));
      expect(tester.getSize(find.byType(NoteListPreview)).height, lessThan(60));
      expect(find.byType(Image), findsNothing);
      expect(find.text('不显示摘要'), findsNothing);
      expect(find.text('3'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  for (final entry in {'note': '笔记', 'recording': '音频', 'clip': '剪藏'}.entries) {
    testWidgets('shows ${entry.value} without empty tags or author', (
      tester,
    ) async {
      await pumpPreview(tester, {
        'title': '标题',
        'type': entry.key,
        'tags': ['', '  '],
        'author': '  ',
      });
      expect(find.text(entry.value), findsOneWidget);
      expect(find.textContaining('#'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
