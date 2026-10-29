import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:record/record.dart';
import 'package:imind_app/ai_chat.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/asr_session.dart';

class SpeechMic extends AudioRecorder {
  SpeechMic(this.pcm);
  final Uint8List pcm;
  Timer? timer;
  StreamController<Uint8List>? chunks;
  @override
  Future<bool> hasPermission({bool request = true}) async => true;
  @override
  Future<Stream<Uint8List>> startStream(RecordConfig config) async {
    expect(config.sampleRate, 16000);
    expect(config.numChannels, 1);
    var offset = 0;
    chunks = StreamController<Uint8List>();
    timer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      final data = Uint8List(3200);
      for (var i = 0; i < data.length; i++) {
        data[i] = pcm[(offset + i) % pcm.length];
      }
      offset += data.length;
      chunks!.add(data);
    });
    return chunks!.stream;
  }

  @override
  Future<String?> stop() async {
    timer?.cancel();
    await chunks?.close();
    return null;
  }

  @override
  Future<void> dispose() async {
    timer?.cancel();
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'AI voice native mic and real streaming ASR to composer and send',
    (tester) async {
      final api = MulticaApi(baseUrl: defaultApiBase())
        ..token = const String.fromEnvironment('E2E_TOKEN')
        ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
      const machine = String.fromEnvironment('E2E_MACHINE');
      addTearDown(api.close);
      Future<T> real<T>(Future<T> Function() fn) async =>
          (await tester.runAsync(fn)) as T;
      Future<void> until(bool Function() ready) async {
        final deadline = DateTime.now().add(const Duration(seconds: 60));
        while (!ready() && DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 200));
        }
        expect(ready(), isTrue);
      }

      expect(await real(api.workspaceAgents), isEmpty);
      final note = await real(
        () => api.createNote({
          'share_machine': machine,
          'type': 'note',
          'title': 'Voice input ${DateTime.now().millisecondsSinceEpoch}',
          'content': 'Voice acceptance',
        }),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: NoteAiChatSheet(api: api, machine: machine, note: note),
          ),
        ),
      );
      await until(() => find.byType(TextField).evaluate().isNotEmpty);
      await tester.tap(find.byTooltip('语音输入'));
      await until(() => find.text('正在聆听，识别文字将填入输入框').evaluate().isNotEmpty);
      await tester.pump(const Duration(seconds: 1));
      await tester.tap(find.byTooltip('停止语音输入'));
      await until(() => find.byTooltip('语音输入').evaluate().isNotEmpty);
      expect(find.textContaining('语音输入失败'), findsNothing);
      debugPrint('E2E_VOICE: actual native microphone start and stop passed');
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      final events = <Map<String, dynamic>>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: NoteAiChatSheet(
              api: api,
              machine: machine,
              note: note,
              voiceRecorder: SpeechMic(
                base64Decode(const String.fromEnvironment('E2E_PCM')),
              ),
              voiceSessionFactory: (receive) => AsrSession.connect(
                api: api,
                machine: machine,
                onMessage: (event) {
                  events.add(event);
                  receive(event);
                },
              ),
            ),
          ),
        ),
      );
      await until(() => find.byType(TextField).evaluate().isNotEmpty);
      await tester.enterText(find.byType(TextField), '已有草稿：');
      await tester.tap(find.byTooltip('语音输入'));
      await until(
        () => tester
            .widget<TextField>(find.byType(TextField))
            .controller!
            .text
            .contains('测试'),
      );
      expect(events.any((event) => event['type'] == 'partial'), isTrue);
      expect(find.byTooltip('停止语音输入'), findsOneWidget);
      expect(
        tester
            .widget<IconButton>(
              find.widgetWithIcon(IconButton, Icons.arrow_upward),
            )
            .onPressed,
        isNull,
      );
      expect(tester.widget<TextField>(find.byType(TextField)).readOnly, isTrue);
      debugPrint('E2E_VOICE: real ASR partial reached composer BEFORE stop');
      // Keep the streaming draft visible for the host's native screenshot.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 5)),
      );
      await tester.tap(find.byTooltip('停止语音输入'));
      await until(() => find.byTooltip('语音输入').evaluate().isNotEmpty);
      expect(events.any((event) => event['type'] == 'final'), isTrue);
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.controller!.text, startsWith('已有草稿：'));
      expect(field.readOnly, isFalse);
      final text = field.controller!.text;
      debugPrint('E2E_VOICE_TEXT:$text');
      await tester.tap(find.byTooltip('发送'));
      await until(() => find.text('Agent 暂不可用 · 重试').evaluate().isNotEmpty);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      expect(find.text(text), findsOneWidget);
      expect(tester.takeException(), isNull);
      debugPrint(
        'E2E_VOICE: drained final, preserved draft, manual send persisted',
      );
    },
    timeout: const Timeout(Duration(minutes: 4)),
  );
}
