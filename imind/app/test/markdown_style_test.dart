import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/markdown_style.dart';
import 'package:imind_app/media.dart';

void main() {
  testWidgets('note Markdown scales all sized text roles by twenty percent', (
    tester,
  ) async {
    final theme = ThemeData(useMaterial3: true);
    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        home: const Scaffold(body: IMindMarkdown(data: '# Heading\n\nBody')),
      ),
    );
    final style = tester
        .widget<MarkdownBody>(find.byType(MarkdownBody))
        .styleSheet!;
    final original = MarkdownStyleSheet.fromTheme(
      Theme.of(tester.element(find.byType(IMindMarkdown))),
    );
    final roles = <String, List<TextStyle?>>{
      'body': [original.p, style.p],
      'h1': [original.h1, style.h1],
      'h2': [original.h2, style.h2],
      'h3': [original.h3, style.h3],
      'h4': [original.h4, style.h4],
      'h5': [original.h5, style.h5],
      'h6': [original.h6, style.h6],
      'code': [original.code, style.code],
      'quote': [original.blockquote, style.blockquote],
      'list marker': [original.listBullet, style.listBullet],
      'table': [original.tableBody, style.tableBody],
      'image alt': [original.img, style.img],
      'checkbox': [original.checkbox, style.checkbox],
    };
    for (final role in roles.entries) {
      expect(
        role.value.last!.fontSize,
        closeTo(role.value.first!.fontSize! * 1.2, 0.0001),
        reason: role.key,
      );
    }
  });

  testWidgets('chat keeps its original body size, color and line height', (
    tester,
  ) async {
    late MarkdownStyleSheet style;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            style = imindMarkdownStyle(
              context,
              bodyFontSize: 15,
              textColor: Colors.red,
              bodyHeight: 1.55,
            );
            return const SizedBox();
          },
        ),
      ),
    );
    expect(style.p!.fontSize, 18);
    expect(style.p!.color, Colors.red);
    expect(style.p!.height, 1.55);
  });
}
