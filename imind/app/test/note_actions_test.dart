import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/note_actions.dart';

void main() {
  testWidgets(
    'file info displays added YAML fields without replacing the filename',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            appBar: AppBar(
              title: const DetailTitle('Filename'),
              actions: [
                NoteActions(
                  note: const {
                    'title': 'Filename',
                    'content': 'Body',
                    'metadata': {
                      'title': 'YAML title',
                      'author': 'Writer',
                      'custom': {
                        'published': true,
                        'topics': ['one', 'two'],
                      },
                    },
                  },
                  onRename: () {},
                  onAiRename: () {},
                  onDelete: () {},
                ),
              ],
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('更多'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('文件信息'));
      await tester.pumpAndSettle();
      expect(find.text('Filename'), findsOneWidget);
      expect(find.text('YAML title'), findsOneWidget);
      expect(find.text('author'), findsOneWidget);
      expect(find.text('Writer'), findsOneWidget);
      expect(find.textContaining('"published": true'), findsOneWidget);
      expect(find.text('metadata'), findsNothing);
    },
  );
}
