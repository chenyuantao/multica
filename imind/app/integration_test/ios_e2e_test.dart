import 'dart:convert';
import 'dart:typed_data';

import 'package:imind_app/asr_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/session.dart';
import 'package:http/http.dart' as http;

// Inject one transport failure; every retry still uses the real Docker API.
class FailFirstMediaUpload extends http.BaseClient {
  final _inner = http.Client();
  Uint8List? failedBytes;
  int attempts = 0;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.method == 'POST' && request.url.path == '/api/imind/media') {
      attempts++;
      final bytes = (request as http.Request).bodyBytes;
      if (attempts == 1) {
        failedBytes = Uint8List.fromList(bytes);
        return http.StreamedResponse(
          Stream.value(utf8.encode('{"error":"injected upload failure"}')),
          503,
          headers: {'content-type': 'application/json'},
        );
      }
      expect(
        listEquals(bytes, failedBytes),
        isTrue,
        reason: 'Retry must retain the complete original PCM recording',
      );
    }
    return _inner.send(request);
  }

  @override
  void close() => _inner.close();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('real API: restore session, read, edit, join file chat, persist', (
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
    final transport = FailFirstMediaUpload();
    final appApi = MulticaApi(baseUrl: defaultApiBase(), client: transport);
    addTearDown(appApi.close);
    await tester.pumpWidget(IMindApp(api: appApi, sessionStore: store));
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
    expect(find.text('AI+ 群聊'), findsOneWidget);
    final savedAfterAiOpen = await api.getNote(machine, note['id'] as String);
    final chat = await api.ensureNoteChat(
      machine,
      note['id'] as String,
      revision: savedAfterAiOpen['revision'] as String,
    );
    expect(chat['joined'], isTrue);
    expect(chat['issue_id'], isNotEmpty);
    expect(
      (await api.noteChatHistory(chat['issue_id'] as String))['comments'],
      isEmpty,
    );
    // The isolated validation workspace must have no Agents. Assert before
    // sending so this check cannot launch a real Agent or installed CLI.
    expect(await api.workspaceAgents(), isEmpty);
    await tester.enterText(
      find.byType(TextField).last,
      'iOS E2E no-agent message',
    );
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    List<Map<String, dynamic>> history = [];
    for (var i = 0; i < 40; i++) {
      history =
          ((await api.noteChatHistory(chat['issue_id'] as String))['comments']
                  as List)
              .cast<Map<String, dynamic>>();
      if (history.any(
        (message) => message['content'] == 'iOS E2E no-agent message',
      )) {
        break;
      }
      await tester.pump(const Duration(milliseconds: 250));
    }
    final persistedMessage = history.singleWhere(
      (message) => message['content'] == 'iOS E2E no-agent message',
    );
    expect(persistedMessage['imind_agent_status'], 'unavailable');
    expect(find.text('Agent 暂不可用 · 重试'), findsOneWidget);
    await tester.tap(find.text('Agent 暂不可用 · 重试'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Agent 暂时不可用，消息已保留'), findsOneWidget);
    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();
    final saved = await api.getNote(machine, note['id'] as String);
    expect(saved['content'], 'iOS E2E saved **Markdown**');
    await tester.tap(find.textContaining('iOS E2E saved'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AI+'));
    await tester.pumpAndSettle();
    expect(find.text('AI+ 群聊'), findsOneWidget);
    final reopened = await api.ensureNoteChat(
      machine,
      note['id'] as String,
      revision:
          (await api.getNote(machine, note['id'] as String))['revision']
              as String,
    );
    expect(reopened['issue_id'], chat['issue_id']);
    final reopenedHistory =
        ((await api.noteChatHistory(reopened['issue_id'] as String))['comments']
                as List)
            .cast<Map<String, dynamic>>();
    expect(
      reopenedHistory.any(
        (message) => message['content'] == 'iOS E2E no-agent message',
      ),
      isTrue,
    );
    expect(
      reopenedHistory.singleWhere(
        (message) => message['content'] == 'iOS E2E no-agent message',
      )['imind_agent_status'],
      'unavailable',
    );
    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();
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
    await tester.enterText(find.byType(TextField).first, '收藏这个链接：$clipUrl。');
    await tester.tap(find.widgetWithText(FilledButton, '剪藏'));
    await tester.pumpAndSettle();
    final clips = (await api.notes(machine))
        .where((n) => n['source_url'] == clipUrl)
        .toList();
    expect(clips, hasLength(1));
    expect(clips.single['type'], 'clip');
    await waitFor(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();
    debugPrint('E2E_CHECK: delete and clip placeholder persisted in file chat');
    final recordingTitle =
        'Native mic ${DateTime.now().microsecondsSinceEpoch}';
    final beforeRecordIds = (await api.notes(machine))
        .map((note) => note['id'])
        .toSet();
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
    await tester.tap(find.widgetWithText(TextButton, '暂停'));
    await waitFor(find.text('开始'));
    await tester.tap(find.text('开始'));
    await waitFor(find.text('正在听…'));
    await tester.pump(const Duration(seconds: 2));
    await tester.tap(find.widgetWithText(PillButton, '笔记'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, recordingTitle);
    await tester.tap(find.text('正文'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField).last,
      'Native recording companion',
    );
    await tester.tap(find.widgetWithText(TextButton, '保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '保存'));
    await waitFor(find.text('injected upload failure'));
    expect(find.byTooltip('菜单'), findsNothing);
    expect(transport.attempts, 1);
    await tester.tap(find.widgetWithText(PillButton, '保存'));
    if (!const bool.fromEnvironment('E2E_NAMING_CONFIGURED')) {
      await waitFor(find.text('保留原标题'));
      await tester.tap(find.text('保留原标题'));
    }
    await waitFor(find.byTooltip('菜单'));
    expect(transport.attempts, 2);
    final newRecordings = (await api.notes(machine))
        .where(
          (note) =>
              note['type'] == 'recording' &&
              !beforeRecordIds.contains(note['id']),
        )
        .toList();
    expect(newRecordings, hasLength(1));
    final recording = await api.getNote(
      machine,
      newRecordings.single['id'] as String,
    );
    expect(recording['content'], contains('Native recording companion'));
    if (const bool.fromEnvironment('E2E_NAMING_CONFIGURED')) {
      expect(recording['summary'], isNotEmpty);
      debugPrint(
        'E2E_CHECK: saved native recording automatically named with real DeepSeek summary',
      );
    }
    expect(recording['audio']['file'], 'audio.wav');
    final bytes = await api.getMedia(
      machine: machine,
      noteId: recording['id'] as String,
      name: 'audio.wav',
    );
    expect(bytes.length, greaterThan(32044));
    expect(listEquals(bytes, transport.failedBytes), isTrue);
    debugPrint(
      'E2E_CHECK: failed original-audio upload retained exact bytes and retried without duplicate note',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: RecordingDetail(api: api, machine: machine, note: recording),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(PillButton, '播放'));
    await waitFor(find.widgetWithText(PillButton, '暂停'));
    await tester.tap(find.widgetWithText(PillButton, '暂停'));
    await waitFor(find.widgetWithText(PillButton, '播放'));
    expect(tester.takeException(), isNull);
    debugPrint(
      'E2E_CHECK: native microphone pause/resume, companion note, durable original WAV and native playback passed',
    );
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
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
