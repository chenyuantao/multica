import 'dart:convert';
import 'dart:io' show pid;
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:integration_test/integration_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/media.dart';

class FixturePicker extends ImagePicker {
  @override
  Future<XFile?> pickImage({
    required ImageSource source,
    double? maxWidth,
    double? maxHeight,
    int? imageQuality,
    CameraDevice preferredCameraDevice = CameraDevice.rear,
    bool requestFullMetadata = true,
  }) async => XFile.fromData(
    base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
    ),
    mimeType: 'image/png',
    name: 'e2e.png',
  );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'shared image insertion reopen and native persisted WAV playback',
    (tester) async {
      final api = MulticaApi(baseUrl: defaultApiBase())
        ..token = const String.fromEnvironment('E2E_TOKEN')
        ..workspaceId = const String.fromEnvironment('E2E_WORKSPACE');
      const machine = String.fromEnvironment('E2E_MACHINE');
      addTearDown(api.close);
      Future<void> wait(Finder finder) async {
        for (var i = 0; i < 150; i++) {
          await tester.pump(const Duration(milliseconds: 200));
          if (finder.evaluate().isNotEmpty) return;
        }
        expect(finder, findsWidgets);
      }

      Future<T> real<T>(Future<T> Function() action) async {
        final value = await tester.runAsync(action);
        return value as T;
      }

      debugPrint('E2E_APP_PID:$pid');
      const restoreId = String.fromEnvironment('E2E_MEDIA_NOTE');
      if (restoreId.isNotEmpty) {
        final restored = await real(() => api.getNote(machine, restoreId));
        expect(restored['audio']['file'], 'audio.wav');
        await tester.pumpWidget(
          MaterialApp(
            home: RecordingDetail(api: api, machine: machine, note: restored),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(PillButton, '播放'));
        await wait(find.widgetWithText(PillButton, '暂停'));
        await tester.pump(const Duration(seconds: 7));
        await wait(find.widgetWithText(PillButton, '播放'));
        expect(tester.takeException(), isNull);
        debugPrint(
          'E2E_MEDIA: separate App process loaded persisted original WAV and native playback completed',
        );
        debugPrint('E2E_MEDIA_NOTE:$restoreId');
        return;
      }
      final note = await real(
        () => api.createNote({
          'share_machine': machine,
          'type': 'note',
          'title': 'Media E2E ${DateTime.now().millisecondsSinceEpoch}',
          'content': 'Keep original text',
        }),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: NoteEditor(
            api: api,
            machine: machine,
            note: note,
            imagePicker: FixturePicker(),
          ),
        ),
      );
      await tester.tap(find.text('Keep original text'));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 1));
      await tester.ensureVisible(find.text('选图'));
      await tester.tap(find.text('选图'));
      await tester.pumpAndSettle();
      await wait(
        find.byWidgetPredicate(
          (widget) =>
              widget is TextField &&
              (widget.controller?.text.contains('media/') ?? false),
        ),
      );
      await tester.pump(const Duration(seconds: 1));
      await tester.tap(find.byTooltip('撤销'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField).last).controller!.text,
        'Keep original text',
      );
      await tester.tap(find.byTooltip('重做'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField).last).controller!.text,
        contains('media/'),
      );
      await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
      await tester.tap(find.text('保存'));
      await wait(find.byTooltip('返回'));
      final saved = await real(
        () => api.getNote(machine, note['id'] as String),
      );
      expect(saved['content'], contains('Keep original text'));
      expect(saved['content'], contains('media/${note['id']}/'));
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.pumpWidget(
        MaterialApp(
          home: NoteEditor(api: api, machine: machine, note: saved),
        ),
      );
      await wait(find.byType(Image));
      expect(tester.takeException(), isNull);
      debugPrint(
        'E2E_MEDIA: injected picker, real upload, saved relative Markdown, reopened authorized image rendered',
      );

      final samples = Uint8List(16000 * 2 * 6);
      final data = ByteData.sublistView(samples);
      for (var i = 0; i < samples.length ~/ 2; i++) {
        data.setInt16(
          i * 2,
          (sin(i * 2 * pi * 440 / 16000) * 5000).round(),
          Endian.little,
        );
      }
      final wav = pcm16MonoWav(samples);
      final recording = await real(
        () => api.createNote({
          'share_machine': machine,
          'type': 'recording',
          'title': 'Playback E2E ${DateTime.now().millisecondsSinceEpoch}',
          'content': 'Persisted companion note',
          'transcript': '<!-- transcript: 00:00.000 -->\nPersisted transcript',
          'audio': {
            'duration_ms': 6000,
            'format': 'wav_pcm_s16le',
            'sample_rate_hz': 16000,
            'file': 'audio.wav',
          },
        }),
      );
      await real(
        () => api.uploadMedia(
          machine: machine,
          noteId: recording['id'] as String,
          name: 'audio.wav',
          contentType: 'audio/wav',
          bytes: wav,
        ),
      );
      debugPrint('E2E_MEDIA_NOTE:${recording['id']}');
      final reread = await real(
        () => api.getNote(machine, recording['id'] as String),
      );
      final persisted = await real(
        () => api.getMedia(
          machine: machine,
          noteId: recording['id'] as String,
          name: 'audio.wav',
        ),
      );
      expect(persisted, wav);
      await tester.pumpWidget(
        MaterialApp(
          home: RecordingDetail(api: api, machine: machine, note: reread),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(PillButton, '播放'));
      await wait(find.widgetWithText(PillButton, '暂停'));
      await tester.pump(const Duration(seconds: 1));
      expect(find.byType(Slider), findsOneWidget);
      await tester.tap(find.widgetWithText(PillButton, '暂停'));
      await wait(find.widgetWithText(PillButton, '播放'));
      await tester.tap(find.widgetWithText(PillButton, '播放'));
      await wait(find.widgetWithText(PillButton, '暂停'));
      await tester.pump(const Duration(seconds: 7));
      await wait(find.widgetWithText(PillButton, '播放'));
      expect(tester.takeException(), isNull);
      debugPrint(
        'E2E_MEDIA: persisted WAV bytes, native playback, pause, resume and completion passed; audible quality is not asserted',
      );
    },
    timeout: const Timeout(Duration(minutes: 4)),
  );
}
