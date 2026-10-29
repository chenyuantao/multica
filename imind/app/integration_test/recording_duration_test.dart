import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:record/record.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/transcript.dart';

class SyntheticRecorder extends AudioRecorder {
  SyntheticRecorder(this.pcm);
  final Uint8List pcm;
  Timer? timer;
  StreamController<Uint8List>? controller;
  @override
  Future<bool> hasPermission({bool request = true}) async => true;
  @override
  Future<Stream<Uint8List>> startStream(RecordConfig config) async {
    expect(config.sampleRate, 16000);
    expect(config.numChannels, 1);
    var offset = 0;
    controller = StreamController<Uint8List>();
    timer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      final chunk = Uint8List(3200);
      for (var i = 0; i < chunk.length; i++) {
        chunk[i] = pcm[(offset + i) % pcm.length];
      }
      offset += chunk.length;
      controller!.add(chunk);
    });
    return controller!.stream;
  }

  @override
  Future<String?> stop() async {
    timer?.cancel();
    await controller?.close();
    return null;
  }

  @override
  Future<void> dispose() async {
    timer?.cancel();
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('pause resume and three minute recording with real ASR', (
    tester,
  ) async {
    final api = MulticaApi(baseUrl: defaultApiBase())
      ..token = const String.fromEnvironment('E2E_TOKEN')
      ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
    const machine = String.fromEnvironment('E2E_MACHINE');
    final before = (await api.notes(machine)).map((n) => n['id']).toSet();
    final recorder = SyntheticRecorder(
      base64Decode(const String.fromEnvironment('E2E_PCM')),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => RecordPage(
                    api: api,
                    machine: machine,
                    recorder: recorder,
                  ),
                ),
              ),
              child: const Text('Open recorder'),
            ),
          ),
        ),
      ),
    );
    Future<void> until(Finder finder) async {
      final deadline = DateTime.now().add(const Duration(seconds: 35));
      while (finder.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(finder, findsWidgets);
    }

    Future<void> recordFor(int seconds) async {
      final deadline = DateTime.now().add(Duration(seconds: seconds));
      while (DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
    }

    await tester.tap(find.text('Open recorder'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('开始'));
    await until(find.text('正在听…'));
    await recordFor(10);
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '暂停'));
    await until(find.text('开始'));
    debugPrint('E2E_DURATION: paused after 10 seconds');
    final pausedText = tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data)
        .toList();
    await recordFor(3);
    expect(
      tester.widgetList<Text>(find.byType(Text)).map((t) => t.data).toList(),
      pausedText,
    );
    await tester.tap(find.widgetWithText(PillButton, '笔记'));
    await tester.pumpAndSettle();
    final recordingTitle =
        'Duration note ${DateTime.now().millisecondsSinceEpoch}';
    await tester.enterText(find.byType(TextField).first, recordingTitle);
    await tester.tap(find.text('正文'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField).last,
      'Notes written during paused recording',
    );
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('开始'));
    await recordFor(175);
    debugPrint('E2E_DURATION: resumed recording completed');
    expect(
      find.text('开始'),
      findsNothing,
      reason: 'Recording must remain active until manual stop',
    );
    await tester.tap(find.text('保存').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '保存'));
    if (!const bool.fromEnvironment('E2E_NAMING_CONFIGURED')) {
      await until(find.text('保留原标题'));
      await tester.tap(find.text('保留原标题'));
    }
    await until(find.text('Open recorder'));
    final created = (await api.notes(machine))
        .where((n) => !before.contains(n['id']))
        .toList();
    expect(created, hasLength(1));
    final saved = await api.getNote(machine, created.single['id'] as String);
    if (!const bool.fromEnvironment('E2E_NAMING_CONFIGURED')) {
      expect(saved['title'], recordingTitle);
    } else {
      expect(saved['summary'], isNotEmpty);
    }
    expect(saved['content'], 'Notes written during paused recording');
    final duration = (saved['audio'] as Map)['duration_ms'] as int;
    expect(duration, greaterThanOrEqualTo(180000));
    final segments = parseTranscript(saved['transcript'] as String);
    expect(segments.length, greaterThan(2));
    expect(segments.first.text, contains('测试'));
    expect(segments.last.startMs, greaterThan(120000));
    for (var i = 1; i < segments.length; i++) {
      expect(
        segments[i].startMs,
        greaterThanOrEqualTo(segments[i - 1].startMs),
      );
    }
    expect(segments.where((s) => s.startMs < 10000), isNotEmpty);
    expect(segments.where((s) => s.startMs > 10000), isNotEmpty);
    expect(tester.takeException(), isNull);
    debugPrint(
      'E2E_DURATION_RESULT: duration_ms=$duration segments=${segments.length} last_ms=${segments.last.startMs} id=${saved['id']}',
    );
    api.close();
  }, timeout: const Timeout(Duration(minutes: 6)));
}
