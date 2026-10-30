import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart' hide Flow;
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:record/record.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/api.dart';

import 'features_e2e_test.dart' show Flow;

// Only the capture source changes; the editor and authenticated ASR stay real.
class PcmCapture extends RecordPlatform {
  bool permission = true;
  int stops = 0, disposals = 0;
  final timers = <String, Timer>{};
  final streams = <String, StreamController<Uint8List>>{};
  final pcm = base64Decode(const String.fromEnvironment('E2E_PCM'));
  @override
  Future<void> create(String recorderId) async {}
  @override
  Future<bool> hasPermission(String recorderId, {bool request = true}) async =>
      permission;
  @override
  Stream<RecordState> onStateChanged(String recorderId) => const Stream.empty();
  @override
  void setOnConfigChanged(
    String recorderId,
    void Function(RecordConfig)? handler,
  ) {}
  @override
  Future<Stream<Uint8List>> startStream(
    String recorderId,
    RecordConfig config,
  ) async {
    expect(config.sampleRate, 16000);
    expect(config.numChannels, 1);
    final stream = streams[recorderId] = StreamController<Uint8List>();
    var offset = 0;
    timers[recorderId] = Timer.periodic(const Duration(milliseconds: 100), (_) {
      stream.add(
        Uint8List.fromList(
          List.generate(3200, (i) => pcm[(offset + i) % pcm.length]),
        ),
      );
      offset += 3200;
    });
    return stream.stream;
  }

  @override
  Future<String?> stop(String recorderId) async {
    stops++;
    timers.remove(recorderId)?.cancel();
    await streams.remove(recorderId)?.close();
    return null;
  }

  @override
  Future<void> dispose(String recorderId) async {
    disposals++;
    await stop(recorderId);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> until(
  WidgetTester tester,
  bool Function() condition, {
  int seconds = 60,
}) async {
  final deadline = DateTime.now().add(Duration(seconds: seconds));
  while (!condition() && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 150));
  }
  expect(condition(), isTrue);
}

Future<void> capture(WidgetTester tester, String name) async {
  debugPrint('E2E_DETAIL_CAPTURE: $name');
  await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
}

Future<void> readyDetail(Flow f) => until(
  f.tester,
  () => find
      .byType(PopupMenuButton<String>)
      .evaluate()
      .any((e) => (e.widget as PopupMenuButton<String>).enabled),
);

Future<void> menu(Flow f, String label) async {
  await readyDetail(f);
  await f.tap(find.byTooltip('更多'));
  await f.tap(find.text(label));
}

Future<Map<String, dynamic>> fixture(
  Flow f,
  String type, {
  List<String> tags = const [],
  String? content,
}) async {
  final title = '交互验收 $type ${DateTime.now().microsecondsSinceEpoch}';
  final body = content ?? '阅读正文与编辑字号一致';
  final note = await f.api.createNote({
    'share_machine': Flow.machine,
    'type': type,
    'title': title,
    'content': body,
    if (type == 'recording') 'transcript': '录音转写原文',
    'tags': tags,
  });
  if (type != 'clip') return note;
  // Clip creation always creates an empty placeholder; complete the saved fixture.
  return f.api.updateNote('${note['id']}', {
    'share_machine': Flow.machine,
    'revision': note['revision'],
    'title': title,
    'content': body,
    'transcript': '',
    'tags': tags,
  });
}

Future<void> clean(Flow f, List<Map<String, dynamic>> notes) async {
  await f.tester.pumpWidget(const SizedBox());
  await f.tester.pumpAndSettle();
  for (final note in notes) {
    final current = await f.api.getNote(Flow.machine, '${note['id']}');
    await f.api.deleteNote(
      '${note['id']}',
      Flow.machine,
      '${current['revision']}',
    );
  }
  f.api.close();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'home toolbar, real pull refresh, horizontal OR tags and clear retain kind',
    (tester) async {
      final f = Flow(tester);
      final suffix = DateTime.now().microsecondsSinceEpoch;
      final a = '000-a-$suffix', b = '000-b-$suffix';
      final notes = <Map<String, dynamic>>[];
      try {
        notes.add(await fixture(f, 'note', tags: [a]));
        notes.add(await fixture(f, 'note', tags: [b]));
        notes.add(await fixture(f, 'recording', tags: [a]));
        await f.start();
        await f.wait(find.text('${notes[0]['title']}'));
        final heading = find.byKey(const ValueKey('detail-title'));
        expect(tester.widget<Text>(heading).style!.fontSize, 17);
        expect(
          tester.getCenter(heading).dx,
          greaterThan(tester.getCenter(find.byTooltip('菜单')).dx),
        );
        final clip = find.widgetWithText(PillButton, '剪藏');
        expect(
          tester.getCenter(clip).dx,
          greaterThan(
            tester.getCenter(find.widgetWithText(PillButton, '录音')).dx,
          ),
        );
        expect(
          tester.getCenter(clip).dx,
          lessThan(tester.getCenter(find.widgetWithText(PillButton, '笔记')).dx),
        );
        await f.tap(find.byTooltip('更多'));
        expect(find.text('网页剪藏'), findsNothing);
        await f.tap(find.text('排序方式'));
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await f.tap(clip);
        expect(find.text('网页剪藏'), findsOneWidget);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await f.menu('笔记');
        Future<void> chip(String tag) =>
            f.tap(find.widgetWithText(FilterChip, '#$tag'));
        await chip(a);
        expect(find.text('${notes[0]['title']}'), findsOneWidget);
        expect(find.text('${notes[1]['title']}'), findsNothing);
        await chip(b);
        expect(find.text('${notes[0]['title']}'), findsOneWidget);
        expect(find.text('${notes[1]['title']}'), findsOneWidget);
        expect(find.text('${notes[2]['title']}'), findsNothing);
        await capture(tester, 'home-or-tags');
        await chip(a);
        expect(find.text('${notes[0]['title']}'), findsNothing);
        await f.tap(find.widgetWithText(TextButton, '取消'));
        expect(find.text('${notes[2]['title']}'), findsNothing);
        expect(find.text('${notes[0]['title']}'), findsOneWidget);
        await f.menu('全部');
        notes.add(await fixture(f, 'note', tags: [a]));
        expect(find.text('${notes.last['title']}'), findsNothing);
        await tester.drag(find.byType(RefreshIndicator), const Offset(0, 450));
        await f.wait(find.text('${notes.last['title']}'));
        // Empty filtered list still reaches the real API on pull.
        await f.menu('音频');
        await chip(b);
        expect(find.text('没有文件'), findsOneWidget);
        notes.add(await fixture(f, 'recording', tags: [b]));
        await tester.drag(find.byType(RefreshIndicator), const Offset(0, 450));
        await f.wait(find.text('${notes.last['title']}'));
        expect(tester.takeException(), isNull);
        debugPrint(
          'E2E_INTERACTION: home placement, clip, real refresh, empty filtered refresh, OR deselect and kind-preserving clear passed',
        );
      } finally {
        await clean(f, notes);
      }
    },
  );

  testWidgets(
    'real saved timestamps sort in four directions and search composes with tags',
    (tester) async {
      final f = Flow(tester);
      final tag = '000-search-${DateTime.now().microsecondsSinceEpoch}';
      final notes = <Map<String, dynamic>>[];
      try {
        notes.add(
          await fixture(f, 'note', tags: [tag], content: 'Alpha body needle'),
        );
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 1100)),
        );
        notes.add(
          await fixture(f, 'note', tags: [tag], content: 'Beta body haystack'),
        );
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 1100)),
        );
        notes[0] = await f.api.updateNote('${notes[0]['id']}', {
          'share_machine': Flow.machine,
          'revision': notes[0]['revision'],
          'title': 'Search ALPHA ${DateTime.now().microsecondsSinceEpoch}',
          'content': 'Alpha body needle',
          'transcript': '',
          'tags': [tag],
        });
        await f.start();
        await f.wait(find.text('${notes[0]['title']}'));
        await f.tap(find.widgetWithText(FilterChip, '#$tag'));
        Future<void> order(String label, int first) async {
          await f.tap(find.byTooltip('更多'));
          await f.tap(find.text('排序方式'));
          await f.tap(find.text(label));
          expect(
            tester.getTopLeft(find.text('${notes[first]['title']}')).dy,
            lessThan(
              tester.getTopLeft(find.text('${notes[1 - first]['title']}')).dy,
            ),
          );
        }

        await order('创建时间 · 倒序', 1);
        await order('创建时间 · 正序', 0);
        await order('更新时间 · 倒序', 0);
        await order('更新时间 · 正序', 1);
        await f.tap(find.byTooltip('搜索'));
        final input = find.byType(TextField);
        await tester.enterText(input, 'alpha');
        await tester.pump(const Duration(milliseconds: 350));
        await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
        await tester.pumpAndSettle();
        await f.wait(find.text('${notes[0]['title']}'));
        expect(find.text('${notes[1]['title']}'), findsNothing);
        await tester.enterText(input, 'HAYSTACK');
        await tester.pump(const Duration(milliseconds: 350));
        await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
        await tester.pumpAndSettle();
        await f.wait(find.text('${notes[1]['title']}'));
        expect(tester.widget<TextField>(input).controller!.text, 'HAYSTACK');
        expect(find.text('${notes[0]['title']}'), findsNothing);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(TextField), findsNothing);
        expect(find.text('${notes[0]['title']}'), findsOneWidget);
        expect(find.text('${notes[1]['title']}'), findsOneWidget);
        expect(
          tester
              .widget<FilterChip>(find.widgetWithText(FilterChip, '#$tag'))
              .selected,
          isTrue,
        );
        await capture(tester, 'search-sort');
        expect(tester.takeException(), isNull);
        debugPrint(
          'E2E_INTERACTION: four real timestamp sorts, case-insensitive title/body search and system back preserving tags passed',
        );
      } finally {
        await clean(f, notes);
      }
    },
  );

  for (final type in ['note', 'clip', 'recording']) {
    testWidgets(
      '$type read-only taps, native edge pop, edit confirmation and full discard',
      (tester) async {
        final f = Flow(tester);
        final note = await fixture(f, type);
        try {
          await f.start();
          await f.tap(find.text('${note['title']}'));
          await f.wait(
            find.text(type == 'recording' ? '录音转写原文' : '阅读正文与编辑字号一致'),
          );
          await f.tap(find.byKey(const ValueKey('detail-title')));
          await f.tap(
            find.text(type == 'recording' ? '录音转写原文' : '阅读正文与编辑字号一致'),
          );
          expect(find.byType(TextField), findsNothing);
          if (type != 'recording') {
            final markdown = tester.widget<MarkdownBody>(
              find.byType(MarkdownBody).first,
            );
            expect(markdown.styleSheet!.p!.fontSize, 16);
          }
          final size = tester.getSize(find.byType(Scaffold).last);
          if (Platform.isIOS) {
            await tester.timedDragFrom(
              Offset(1, size.height / 2),
              Offset(size.width * .85, 0),
              const Duration(milliseconds: 500),
            );
          } else {
            await tester.binding.handlePopRoute();
          }
          await f.wait(find.byTooltip('菜单'));
          await f.tap(find.text('${note['title']}'));
          await menu(f, '编辑');
          final field = find.byType(TextField).last;
          expect(tester.widget<TextField>(field).style!.fontSize, 16);
          expect(find.widgetWithText(TextButton, 'AI+'), findsNothing);
          expect(find.widgetWithText(TextButton, '标签'), findsNothing);
          expect(find.byTooltip('语音输入'), findsOneWidget);
          await f.text(field, '取消后保留草稿');
          if (Platform.isIOS) {
            await tester.dragFrom(
              Offset(1, size.height / 2),
              const Offset(220, 0),
            );
          } else {
            await tester.binding.handlePopRoute();
          }
          await f.wait(find.text('放弃修改？'));
          await capture(tester, '$type-exit-confirm');
          await f.tap(find.widgetWithText(TextButton, '取消'));
          expect(tester.widget<TextField>(field).controller!.text, '取消后保留草稿');
          await tester.binding.handlePopRoute();
          await f.wait(find.text('放弃修改？'));
          await f.tap(
            find.descendant(
              of: find.byType(AlertDialog),
              matching: find.widgetWithText(TextButton, '放弃'),
            ),
          );
          await f.wait(find.byTooltip('菜单'));
          expect(
            (await f.api.getNote(
              Flow.machine,
              '${note['id']}',
            ))[type == 'recording' ? 'transcript' : 'content'],
            type == 'recording' ? '录音转写原文' : '阅读正文与编辑字号一致',
          );
          await f.tap(find.text('${note['title']}'));
          await menu(f, '编辑');
          await f.text(find.byType(TextField).last, '顶部放弃草稿');
          await f.tap(find.widgetWithText(TextButton, '放弃'));
          await f.wait(find.byTooltip('返回'));
          expect(find.byType(TextField), findsNothing);
          expect(find.text('顶部放弃草稿'), findsNothing);
          expect(
            find.text(type == 'recording' ? '录音转写原文' : '阅读正文与编辑字号一致'),
            findsOneWidget,
          );
          await f.tap(find.byTooltip('返回'));
          await f.wait(find.byTooltip('菜单'));
          expect(tester.takeException(), isNull);
          debugPrint(
            'E2E_INTERACTION: $type native read pop, menu edit, cancel retains draft, confirm exits and top discard restores reading passed',
          );
        } finally {
          await clean(f, [note]);
        }
      },
    );
  }

  testWidgets(
    'manual existing/new tags, real DeepSeek merge, stale revision and failed request preserve file',
    (tester) async {
      final f = Flow(tester);
      final note = await fixture(
        f,
        'note',
        tags: ['原有标签'],
        content: '周末学习 Flutter 和 iOS 应用开发，制定学习计划，复习状态管理和自动化测试。',
      );
      final other = await fixture(
        f,
        'note',
        tags: ['学习', 'Flutter', '开发', '学习计划'],
      );
      try {
        expect(const bool.fromEnvironment('E2E_NAMING_CONFIGURED'), isTrue);
        await f.start();
        await f.tap(find.text('${note['title']}'));
        await menu(f, '标记');
        await f.tap(find.widgetWithText(ActionChip, '学习'));
        await readyDetail(f);
        var saved = await f.api.getNote(Flow.machine, '${note['id']}');
        expect(saved['tags'], contains('学习'));
        expect(saved['revision'], isNot(note['revision']));
        await menu(f, '标记');
        await f.wait(find.byType(TextField));
        await f.text(find.byType(TextField).last, '手建标签');
        await f.tap(find.widgetWithText(TextButton, '添加'));
        await readyDetail(f);
        saved = await f.api.getNote(Flow.machine, '${note['id']}');
        expect(saved['tags'], containsAll(['原有标签', '学习', '手建标签']));
        final beforeAiRevision = saved['revision'];
        await menu(f, 'AI 标记');
        await until(
          tester,
          () => tester
              .widget<PopupMenuButton<String>>(
                find.byType(PopupMenuButton<String>),
              )
              .enabled,
        );
        saved = await f.api.getNote(Flow.machine, '${note['id']}');
        expect(saved['tags'], containsAll(['原有标签', '学习', '手建标签']));
        expect((saved['tags'] as List).length, greaterThanOrEqualTo(3));
        expect(saved['revision'], isNot(beforeAiRevision));
        expect(saved['content'], note['content']);
        expect(saved['title'], note['title']);
        await capture(tester, 'detail-ai-tags');
        final concurrent = await f.api.updateNote('${note['id']}', {
          'share_machine': Flow.machine,
          'revision': saved['revision'],
          'title': saved['title'],
          'content': '并发保存正文',
          'transcript': '',
          'tags': saved['tags'],
        });
        await menu(f, 'AI 标记');
        await f.wait(find.textContaining('note changed since it was loaded'));
        expect(
          (await f.api.getNote(Flow.machine, '${note['id']}'))['revision'],
          concurrent['revision'],
        );
        await f.tap(find.byTooltip('返回'));
        await f.wait(find.byTooltip('菜单'));
        await tester.drag(find.byType(RefreshIndicator), const Offset(0, 500));
        await f.wait(find.text('${note['title']}'));
        await tester.longPress(find.text('${note['title']}'));
        await tester.pumpAndSettle();
        await f.tap(find.text('AI 标记'));
        await f.gone(find.text('正在标记'));
        saved = await f.api.getNote(Flow.machine, '${note['id']}');
        expect(saved['content'], '并发保存正文');
        expect(saved['tags'], containsAll(['原有标签', '手建标签']));
        // Invalid revision is rejected by the real endpoint before provider/write.
        await expectLater(
          f.api.tagNote(
            Flow.machine,
            '${note['id']}',
            revision: '${note['revision']}',
          ),
          throwsA(isA<ApiException>().having((e) => e.status, 'status', 409)),
        );
        expect(
          (await f.api.getNote(Flow.machine, '${note['id']}'))['revision'],
          saved['revision'],
        );
        expect(tester.takeException(), isNull);
        debugPrint(
          'E2E_INTERACTION: UI manual tags, real DeepSeek detail/home merge and conflict non-overwrite passed',
        );
      } finally {
        await clean(f, [note, other]);
      }
    },
    timeout: const Timeout(Duration(minutes: 4)),
  );

  testWidgets(
    'authorized image touch presents native Quick Look and returns to detail',
    (tester) async {
      final f = Flow(tester);
      final note = await fixture(f, 'note');
      try {
        const name = 'interaction-image-0123456789.png';
        await f.api.uploadMedia(
          machine: Flow.machine,
          noteId: '${note['id']}',
          name: name,
          contentType: 'image/png',
          bytes: base64Decode(const String.fromEnvironment('E2E_IMAGE')),
        );
        await f.api.updateNote('${note['id']}', {
          'share_machine': Flow.machine,
          'revision': note['revision'],
          'title': note['title'],
          'content': '原生大图验收\n\n![验收图片](media/${note['id']}/$name)',
          'transcript': '',
          'tags': [],
        });
        await f.start();
        await f.tap(find.text('${note['title']}'));
        await f.wait(find.byType(Image));
        await f.tap(find.byType(Image));
        debugPrint(
          'E2E_INTERACTION_NATIVE_VIEWER: host inspect and dismiss Quick Look now',
        );
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 45)),
        );
        await f.tap(find.byTooltip('更多'));
        expect(find.text('编辑'), findsOneWidget);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('detail-title')), findsOneWidget);
        await capture(tester, 'image-native-return');
        expect(tester.takeException(), isNull);
        debugPrint(
          'E2E_INTERACTION: image actual touch/native viewer returned to working detail',
        );
      } finally {
        await clean(f, [note]);
      }
    },
  );

  testWidgets(
    'editor native microphone, real ASR cursor insertion/save drain, denial and disconnect recovery',
    (tester) async {
      final f = Flow(tester);
      final note = await fixture(f, 'note', content: '前文【替换】后文必须保留');
      final native = RecordPlatform.instance;
      final pcm = PcmCapture();
      try {
        await f.start();
        await f.tap(find.text('${note['title']}'));
        await menu(f, '编辑');
        await tester.tap(find.byTooltip('语音输入'));
        await until(
          tester,
          () =>
              find.byTooltip('停止语音输入').evaluate().isNotEmpty &&
              tester
                      .widget<IconButton>(
                        find.byWidgetPredicate(
                          (w) => w is IconButton && w.tooltip == '停止语音输入',
                        ),
                      )
                      .onPressed !=
                  null,
        );
        await tester.pump(const Duration(seconds: 1));
        await tester.tap(find.byTooltip('停止语音输入'));
        await until(tester, () => find.byTooltip('语音输入').evaluate().isNotEmpty);
        expect(find.textContaining('失败'), findsNothing);
        debugPrint(
          'E2E_INTERACTION: editor actual native mic ready/start/stop passed',
        );
        await f.tap(find.widgetWithText(TextButton, '放弃'));
        await f.wait(find.byTooltip('返回'));
        await tester.pump(const Duration(seconds: 1));
        RecordPlatform.instance = pcm;
        await menu(f, '编辑');
        var field = find.byType(TextField).last;
        var controller = tester.widget<TextField>(field).controller!;
        controller.selection = const TextSelection(
          baseOffset: 2,
          extentOffset: 6,
        );
        await tester.tap(find.byTooltip('语音输入'));
        await until(tester, () => controller.text.contains('测试'));
        expect(controller.text, startsWith('前文'));
        expect(controller.text, endsWith('后文必须保留'));
        expect(controller.text, isNot(contains('【替换】')));
        expect(tester.widget<TextField>(field).readOnly, isTrue);
        expect(
          tester
              .widget<TextButton>(find.widgetWithText(TextButton, '加粗'))
              .onPressed,
          isNull,
        );
        await capture(tester, 'editor-streaming-cursor');
        // Save during capture must stop and drain before persisting.
        await tester.tap(find.widgetWithText(TextButton, '保存'));
        await f.wait(find.byTooltip('返回'));
        final saved = await f.api.getNote(Flow.machine, '${note['id']}');
        expect(saved['content'], contains('测试'));
        expect(saved['content'], startsWith('前文'));
        expect(saved['content'], endsWith('后文必须保留'));
        expect(pcm.timers, isEmpty);
        expect(pcm.stops, greaterThan(0));
        await menu(f, '编辑');
        field = find.byType(TextField).last;
        controller = tester.widget<TextField>(field).controller!;
        pcm.permission = false;
        await tester.tap(find.byTooltip('语音输入'));
        await f.wait(find.textContaining('需要麦克风权限'));
        expect(controller.text, saved['content']);
        expect(tester.widget<TextField>(field).readOnly, isFalse);
        pcm.permission = true;
        await tester.tap(find.byTooltip('语音输入'));
        await until(tester, () => controller.text != saved['content']);
        final beforeDisconnect = controller.text;
        debugPrint('E2E_CHAT_RECONNECT_NOW');
        await f.wait(find.textContaining('语音识别中断'));
        expect(controller.text, startsWith('前文'));
        expect(controller.text, contains('后文必须保留'));
        expect(
          controller.text.length,
          greaterThanOrEqualTo(beforeDisconnect.length),
        );
        expect(tester.widget<TextField>(field).readOnly, isFalse);
        expect(pcm.timers, isEmpty);
        await capture(tester, 'editor-disconnect-retains-draft');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 5)),
        );
        await tester.tap(find.byTooltip('语音输入'));
        await until(
          tester,
          () =>
              tester.widget<TextField>(field).readOnly && pcm.timers.isNotEmpty,
        );
        final stopsBeforeDiscard = pcm.stops;
        await f.tap(find.widgetWithText(TextButton, '放弃'));
        await f.wait(find.byTooltip('返回'));
        expect(find.byType(TextField), findsNothing);
        expect(pcm.timers, isEmpty);
        expect(pcm.stops, greaterThan(stopsBeforeDiscard));
        await f.tap(find.byTooltip('返回'));
        await f.wait(find.byTooltip('菜单'));
        expect(pcm.disposals, greaterThan(0));
        expect(
          (await f.api.getNote(Flow.machine, '${note['id']}'))['content'],
          saved['content'],
        );
        expect(tester.takeException(), isNull);
        debugPrint(
          'E2E_INTERACTION: real ASR selection/suffix, save drains, denied permission, real backend disconnect, retry/discard cleanup passed',
        );
      } finally {
        await clean(f, [note]);
        RecordPlatform.instance = native;
      }
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
