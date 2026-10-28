import 'dart:convert';
import 'dart:typed_data';

import 'package:imind_app/asr_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/session.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('real API: restore session, read, edit, AI Mock, persist', (
    tester,
  ) async {
    const token = String.fromEnvironment('E2E_TOKEN');
    const workspace = String.fromEnvironment('E2E_WORKSPACE');
    const machine = String.fromEnvironment('E2E_MACHINE');
    expect(
      token,
      isNotEmpty,
      reason: 'Provide private --dart-define-from-file',
    );
    final store = SessionStore();
    await store.save(
      SessionData(
        baseUrl: defaultApiBase(),
        token: token,
        workspaceId: workspace,
        machine: machine,
      ),
    );
    final api = MulticaApi(baseUrl: defaultApiBase());
    api.token = token;
    api.workspaceId = workspace;
    await api.bootstrap(machine);
    final title = 'iOS27 E2E ${DateTime.now().millisecondsSinceEpoch}';
    final note = await api.createNote({
      'share_machine': machine,
      'type': 'note',
      'title': title,
      'content': 'iOS E2E original',
      'tags': ['e2e-ios'],
    });
    await tester.pumpWidget(IMindApp(sessionStore: store));
    Future<void> waitFor(Finder finder) async {
      for (var i = 0; i < 100; i++) {
        await tester.pump(const Duration(milliseconds: 200));
        if (finder.evaluate().isNotEmpty) return;
      }
      expect(finder, findsWidgets);
    }

    await waitFor(find.text(title));
    await tester.tap(find.text(title));
    await waitFor(find.text('iOS E2E original'));
    await tester.tap(find.text('iOS E2E original'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField).last,
      'iOS E2E saved **Markdown**',
    );
    await tester.tap(find.text('AI+'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '整理重点');
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(find.text('（Mock）已收到：整理重点。正式模型接口尚未接入。'), findsOneWidget);
    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    final saved = await api.getNote(machine, note['id'] as String);
    expect(saved['content'], 'iOS E2E saved **Markdown**');
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('删除'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '删除'));
    await waitFor(find.text('录音'));
    expect(
      (await api.notes(machine)).any((n) => n['id'] == note['id']),
      isFalse,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('更多'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('网页剪藏').last);
    await tester.pumpAndSettle();
    final clipUrl =
        'https://example.com/ios-e2e?run=${DateTime.now().millisecondsSinceEpoch}';
    await tester.enterText(find.byType(TextField).last, '收藏这个链接：$clipUrl。');
    await tester.tap(find.widgetWithText(FilledButton, '剪藏'));
    await tester.pumpAndSettle();
    final clips = (await api.notes(machine))
        .where((n) => n['source_url'] == clipUrl)
        .toList();
    expect(clips, hasLength(1));
    expect(clips.single['type'], 'clip');
    debugPrint('E2E_CHECK: delete and clip persisted');
    await tester.tap(find.widgetWithText(PillButton, '录音'));
    await tester.pumpAndSettle();
    expect(find.text('转写会显示在这里。'), findsOneWidget);
    await tester.tap(find.text('开始'));
    for (var i = 0; i < 100; i++) {
      await tester.pump(const Duration(milliseconds: 200));
      if (find.text('正在听…').evaluate().isNotEmpty) break;
    }
    expect(find.text('正在听…'), findsOneWidget);
    debugPrint('E2E_CHECK: native microphone and real ASR ready');
    await tester.pump(const Duration(seconds: 3));
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '保存'));
    await waitFor(find.text('录音'));
    debugPrint('E2E_CHECK: recording saved');
    api.close();
  });
  testWidgets(
    'real ASR: synthesized Chinese PCM through simulator and backend',
    (tester) async {
      final api = MulticaApi(baseUrl: defaultApiBase())
        ..token = const String.fromEnvironment('E2E_TOKEN')
        ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
      const machine = String.fromEnvironment('E2E_MACHINE');
      final events = <Map<String, dynamic>>[];
      final session = AsrSession.connect(
        api: api,
        machine: machine,
        onMessage: events.add,
      );
      try {
        await session.start();
        final pcm = base64Decode(const String.fromEnvironment('E2E_PCM'));
        expect(pcm, isNotEmpty);
        for (var offset = 0; offset < pcm.length; offset += 3200) {
          session.sendAudio(
            Uint8List.sublistView(
              pcm,
              offset,
              (offset + 3200).clamp(0, pcm.length),
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 100));
        }
        await session.finish();
        final finals = events.where((e) => e['type'] == 'final').toList();
        expect(finals, isNotEmpty);
        final text = finals.map((e) => e['text']).join();
        expect(text, contains('测试'));
        debugPrint('E2E_REAL_ASR_TEXT: $text');
        final note = await api.createNote({
          'share_machine': machine,
          'type': 'recording',
          'title': 'iOS real ASR ${DateTime.now().millisecondsSinceEpoch}',
          'content': '# 真实 ASR 验收',
          'transcript': '<!-- transcript: 00:00.000 -->\n$text',
          'audio': {
            'duration_ms': pcm.length ~/ 32,
            'format': 'pcm_s16le',
            'sample_rate_hz': 16000,
          },
        });
        final saved = await api.getNote(machine, note['id'] as String);
        expect(saved['transcript'], contains(text));
        debugPrint('E2E_CHECK: real transcript persisted and read back');
      } finally {
        await session.close();
        api.close();
      }
    },
  );
}
