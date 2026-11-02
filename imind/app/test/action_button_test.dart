import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/action_button.dart';
import 'package:imind_app/home_chrome.dart';
import 'package:imind_app/note_actions.dart';

void main() {
  testWidgets('icon actions expose names and respect disabled state', (
    tester,
  ) async {
    var calls = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Row(
            children: [
              AppActionButton(
                tooltip: '保存',
                icon: const Icon(Icons.check),
                onPressed: () => calls++,
              ),
              const AppActionButton(
                tooltip: '删除',
                icon: Icon(Icons.delete_outline),
                onPressed: null,
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.text('保存'), findsNothing);
    expect(find.byTooltip('保存'), findsOneWidget);
    await tester.tap(find.byTooltip('保存'));
    await tester.tap(find.byTooltip('删除'));
    expect(calls, 1);
    expect(tester.getSize(find.byType(IconButton).first), const Size(48, 48));
  });

  testWidgets('list and detail share the same title typography', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              HomeHeader(
                title: '会话',
                leadingLabel: '联系人',
                onLeadingPressed: () {},
              ),
              const DetailTitle('会话详情'),
            ],
          ),
        ),
      ),
    );
    final listTitle = tester.widget<Text>(find.text('会话'));
    final detailTitle = tester.widget<Text>(find.text('会话详情'));
    expect(detailTitle.style, listTitle.style);
    expect(detailTitle.maxLines, 1);
  });
}
