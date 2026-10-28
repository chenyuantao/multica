import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/session.dart';

class Flow {
  Flow(this.tester);
  final WidgetTester tester;
  late final api = MulticaApi(baseUrl: defaultApiBase())
    ..token = const String.fromEnvironment('E2E_TOKEN')
    ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
  static const machine = String.fromEnvironment('E2E_MACHINE');
  final store = SessionStore();
  Future<void> start() async {
    await store.save(
      SessionData(
        baseUrl: defaultApiBase(),
        token: api.token!,
        workspaceId: api.workspaceId,
        machine: machine,
      ),
    );
    await tester.pumpWidget(IMindApp(sessionStore: store));
    await wait(find.byTooltip('菜单'));
  }

  Future<void> wait(Finder finder) async {
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    while (finder.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
      await tester.pump(const Duration(milliseconds: 150));
    }
    expect(finder, findsWidgets);
    await tester.pumpAndSettle();
  }

  Future<void> tap(Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  Future<void> text(Finder finder, String value) async {
    await tester.enterText(finder, value);
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await tester.pumpAndSettle();
  }

  Future<void> menu(String label) async {
    await tap(find.byTooltip('菜单'));
    await tap(find.widgetWithText(ListTile, label));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'create format tag discard rename filters sort batch and logout',
    (tester) async {
      final f = Flow(tester);
      final run = DateTime.now().millisecondsSinceEpoch;
      final title = 'Android features $run';
      final tag = 'android-$run';
      final secondTitle = 'Android batch $run';
      final second = await f.api.createNote({'share_machine': Flow.machine, 'type': 'note', 'title': secondTitle, 'content': 'Batch fixture', 'tags': [tag]});
      await f.start();
      await f.tap(find.widgetWithText(PillButton, '笔记'));
      await f.tap(find.byType(TextField).first);
      await f.text(find.byType(TextField).first, title);
      await f.text(find.byType(TextField).last, 'Android body');
      await f.tap(find.widgetWithText(TextButton, '加粗'));
      expect(
        tester.widget<TextField>(find.byType(TextField).last).controller!.text,
        '**Android body**',
      );
      await f.tap(find.widgetWithText(TextButton, '标签'));
      await f.text(find.byType(TextField).last, tag);
      await f.tap(find.widgetWithText(TextButton, '添加'));
      await f.tap(find.widgetWithText(TextButton, '保存'));
      var note = (await f.api.notes(Flow.machine))
          .singleWhere((n) => n['title'] == title);
      var saved = await f.api.getNote(Flow.machine, note['id'] as String);
      expect(saved['content'], '**Android body**');
      expect(saved['tags'], contains(tag));
      await f.tap(find.text('Android body'));
      await f.text(find.byType(TextField).last, 'discard me');
      await f.tap(find.text('放弃'));
      expect(find.text('discard me'), findsNothing);
      expect(find.text('Android body'), findsOneWidget);
      await f.tap(find.byTooltip('更多'));
      await f.tap(find.text('重命名'));
      final renamed = '$title renamed';
      await f.text(find.byType(TextField).last, renamed);
      await f.tap(find.widgetWithText(TextButton, '完成'));
      await f.tap(find.byTooltip('返回'));
      await f.wait(find.text(renamed));
      await f.menu('#$tag');
      expect(find.text(renamed), findsOneWidget);
      await f.menu('音频');
      expect(find.text(renamed), findsNothing);
      await f.menu('笔记');
      await f.wait(find.text(renamed));
      await f.tap(find.byTooltip('更多'));
      await f.tap(find.text('排序方式'));
      await f.menu('#$tag');
      await tester.longPress(find.text(renamed));
      await tester.pumpAndSettle();
      await f.tap(find.text('简介'));
      expect(find.textContaining(renamed), findsWidgets);
      await f.tap(find.widgetWithText(TextButton, '关闭'));
      await f.tap(find.text('AI 命名'));
      final mockTitle = '（Mock）$renamed';
      await f.wait(find.text(mockTitle));
      await tester.longPress(find.text(mockTitle));
      await tester.pumpAndSettle();
      await f.tap(find.text('标记'));
      await f.text(find.byType(TextField).last, '$tag-batch');
      await f.tap(find.text('使用新标签'));
      saved = await f.api.getNote(Flow.machine, note['id'] as String);
      expect(saved['tags'], contains('$tag-batch'));
      expect(saved['content'], '**Android body**');
      await f.wait(find.text(mockTitle));
      await tester.longPress(find.text(mockTitle));
      await tester.pumpAndSettle();
      await f.tap(find.text('重命名'));
      await f.text(find.byType(TextField).last, renamed);
      await f.tap(find.widgetWithText(TextButton, '完成'));
      await f.wait(find.text(renamed));
      await tester.longPress(find.text(renamed));
      await tester.pumpAndSettle();
      await f.tap(find.text(secondTitle));
      await f.tap(find.text('删除'));
      await f.tap(find.widgetWithText(TextButton, '取消'));
      expect(
        (await f.api.notes(Flow.machine)).any((n) => n['id'] == note['id']),
        isTrue,
      );
      await f.tap(find.text('删除'));
      await f.tap(find.widgetWithText(TextButton, '删除'));
      expect(
        (await f.api.notes(Flow.machine)).any((n) => n['id'] == note['id']),
        isFalse,
      );
      expect((await f.api.notes(Flow.machine)).any((n) => n['id'] == second['id']), isFalse);
      await f.menu('全部');
      await f.tap(find.byTooltip('更多'));
      await f.tap(find.text('网页剪藏').last);
      await f.text(find.byType(TextField).last, 'invalid text');
      await f.tap(find.widgetWithText(FilledButton, '剪藏'));
      expect(find.text('没有识别到链接'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await f.tap(find.byTooltip('菜单'));
      final trash = tester.widget<ListTile>(
        find.widgetWithText(ListTile, '回收站'),
      );
      expect(trash.enabled, isFalse);
      await f.tap(find.byTooltip('退出登录'));
      await f.wait(find.text('发送验证码'));
      expect(await f.store.read(defaultApiBase()), isNull);
      expect(tester.takeException(), isNull);
      f.api.close();
      debugPrint(
        'E2E_FEATURES: create, format, tag, discard, rename, filters, sort, batch, clip validation, logout passed',
      );
    },
  );

  testWidgets(
    'recording detail edits transcript and notes together; session restore',
    (tester) async {
      final f = Flow(tester);
      final title =
          'Android recording detail ${DateTime.now().millisecondsSinceEpoch}';
      final note = await f.api.createNote({
        'share_machine': Flow.machine,
        'type': 'recording',
        'title': title,
        'content': 'Original recording note',
        'transcript': '<!-- transcript: 00:01.234 -->\nOriginal spoken words',
        'audio': {
          'duration_ms': 10000,
          'format': 'pcm_s16le',
          'sample_rate_hz': 16000,
        },
      });
      await f.start();
      await f.wait(find.text(title));
      await f.tap(find.text(title));
      await f.wait(find.text('Original spoken words'));
      expect(find.text('00:01'), findsOneWidget);
      final play = tester.widget<PillButton>(
        find.widgetWithText(PillButton, '播放'),
      );
      expect(play.onPressed, isNull);
      await f.tap(find.text('Original spoken words'));
      await f.text(
        find.byType(TextField).last,
        '<!-- transcript: 00:01.234 -->\nUpdated spoken words',
      );
      await f.tap(find.text('笔记').first);
      await f.text(find.byType(TextField).last, 'Updated recording note');
      await f.tap(find.widgetWithText(TextButton, '保存'));
      final saved = await f.api.getNote(Flow.machine, note['id'] as String);
      expect(saved['content'], 'Updated recording note');
      expect(saved['transcript'], contains('Updated spoken words'));
      expect(saved['transcript'], contains('00:01.234'));
      await f.tap(find.byTooltip('返回'));
      await f.wait(find.byTooltip('菜单'));
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
      await tester.pumpWidget(const IMindApp());
      await f.wait(find.byTooltip('菜单'));
      expect(find.text('发送验证码'), findsNothing);
      expect(tester.takeException(), isNull);
      f.api.close();
      debugPrint(
        'E2E_FEATURES: recording detail, retained milliseconds, dual edit, restore passed',
      );
    },
  );
  testWidgets('format undo redo, system back, and real revision conflict preserve data', (tester) async {
    final f = Flow(tester);
    final title = 'Android conflict ${DateTime.now().millisecondsSinceEpoch}';
    final note = await f.api.createNote({'share_machine': Flow.machine, 'type': 'note', 'title': title, 'content': 'Original conflict content'});
    await f.start();
    await f.wait(find.text(title));
    await f.tap(find.text(title));
    await f.wait(find.text('Original conflict content'));
    await f.tap(find.text('Original conflict content'));
    await f.text(find.byType(TextField).last, 'Format this line');
    await tester.pump(const Duration(seconds: 1));
    await f.tap(find.widgetWithText(TextButton, '标题'));
    await tester.pump(const Duration(seconds: 1));
    expect(tester.widget<TextField>(find.byType(TextField).last).controller!.text, '# Format this line');
    await f.tap(find.byTooltip('撤销'));
    expect(tester.widget<TextField>(find.byType(TextField).last).controller!.text, 'Format this line');
    await f.tap(find.byTooltip('重做'));
    expect(tester.widget<TextField>(find.byType(TextField).last).controller!.text, '# Format this line');
    await f.text(find.byType(TextField).last, 'List item');
    await f.tap(find.widgetWithText(TextButton, '列表'));
    expect(tester.widget<TextField>(find.byType(TextField).last).controller!.text, '* List item');
    await f.text(find.byType(TextField).last, 'Ordered item');
    await f.tap(find.widgetWithText(TextButton, '有序列表'));
    expect(tester.widget<TextField>(find.byType(TextField).last).controller!.text, '1. Ordered item');
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Original conflict content'), findsOneWidget);
    await f.tap(find.text('Original conflict content'));
    await f.text(find.byType(TextField).last, 'Unsaved local edit');
    await f.api.updateNote(note['id'] as String, {'share_machine': Flow.machine, 'revision': note['revision'], 'title': title, 'content': 'Concurrent server edit', 'tags': [], 'transcript': ''});
    await f.tap(find.widgetWithText(TextButton, '保存'));
    await f.wait(find.text('note changed since it was loaded'));
    expect(tester.widget<TextField>(find.byType(TextField).last).controller!.text, 'Unsaved local edit');
    expect((await f.api.getNote(Flow.machine, note['id'] as String))['content'], 'Concurrent server edit');
    await f.tap(find.text('放弃'));
    await f.tap(find.byTooltip('返回'));
    await f.wait(find.text(title));
    await f.tap(find.text(title));
    await f.wait(find.text('Concurrent server edit'));
    expect(tester.takeException(), isNull);
    f.api.close();
    debugPrint('E2E_FEATURES: format undo/redo, system back and revision conflict passed');
  });

}
