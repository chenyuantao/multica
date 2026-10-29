import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:record/record.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/asr_session.dart';
import 'package:imind_app/voice_input.dart';

class UnusedChannel implements WebSocketChannel {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class Mic extends AudioRecorder {
  bool permission = true, stopped = false, disposed = false;
  var chunks = StreamController<Uint8List>();
  @override
  Future<bool> hasPermission({bool request = true}) async => permission;
  @override
  Future<Stream<Uint8List>> startStream(RecordConfig config) async {
    expect(config.encoder, AudioEncoder.pcm16bits);
    expect(config.sampleRate, 16000);
    expect(config.numChannels, 1);
    chunks = StreamController<Uint8List>();
    return chunks.stream;
  }

  @override
  Future<String?> stop() async {
    stopped = true;
    return null;
  }

  @override
  Future<void> dispose() async {
    disposed = true;
    await chunks.close();
  }
}

class Session extends AsrSession {
  Session(void Function(Map<String, dynamic>) receive)
    : super(channel: UnusedChannel(), onMessage: receive);
  bool closed = false;
  List<int>? pcm;
  Completer<void>? finalGate;
  @override
  Future<void> start() async {}
  @override
  void sendAudio(List<int> bytes) {
    pcm = bytes;
  }

  void emit(String type, int id, String text) =>
      onMessage({'type': type, 'sentence_id': id, 'text': text});
  @override
  Future<void> finish() async {
    await finalGate?.future;
    emit('final', 1, '结束');
  }

  @override
  Future<void> close() async {
    closed = true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('com.llfbandit.record/messages'),
          (_) async => null,
        );
  });
  MulticaApi api() =>
      MulticaApi(
          baseUrl: 'http://localhost',
          client: MockClient(
            (_) async => http.Response(
              jsonEncode({
                'shares': [
                  {'machine': 'host'},
                ],
              }),
              200,
            ),
          ),
        )
        ..token = 'token'
        ..workspaceId = '11111111-1111-4111-8111-111111111111';
  test('partials replace selection, finals deduplicate, stop drains and permits another dictation', () async {
    final client = api();
    addTearDown(client.close);
    final input = TextEditingController(text: 'A|Z')
      ..selection = const TextSelection(baseOffset: 1, extentOffset: 2);
    final mic = Mic();
    late Session session;
    final voice = VoiceInput(
      api: client,
      machine: 'host',
      input: input,
      recorder: mic,
      sessionFactory: (receive) => session = Session(receive),
    );
    await voice.start();
    expect(voice.active, isTrue);
    mic.chunks.add(Uint8List.fromList([0, 0]));
    await Future<void>.delayed(Duration.zero);
    expect(session.pcm, [0, 0]);
    session.emit('partial', 0, '你');
    expect(input.text, 'A你Z');
    session.emit('partial', 0, '你好');
    expect(input.text, 'A你好Z');
    session.emit('final', 0, '你好');
    session.emit('partial', 0, '旧结果');
    expect(input.text, 'A你好Z');
    session.finalGate = Completer<void>();
    final stopping = voice.stop();
    await Future<void>.delayed(Duration.zero);
    expect(voice.stopping, isTrue);
    expect(mic.stopped, isTrue);
    session.finalGate!.complete();
    await stopping;
    expect(input.text, 'A你好 结束Z');
    session.emit('partial', 99, 'late');
    expect(input.text, 'A你好 结束Z');
    expect(voice.active, isFalse);
    await voice.start();
    session.emit('partial', 0, '再说');
    await voice.stop();
    expect(input.text, 'A你好 结束再说 结束Z');
    voice.dispose();
    await Future<void>.delayed(Duration.zero);
    expect(mic.disposed, isTrue);
    input.dispose();
  });
  test('permission denial preserves draft and provides retry', () async {
    final client = api();
    addTearDown(client.close);
    final mic = Mic()..permission = false;
    final input = TextEditingController(text: 'keep');
    final voice = VoiceInput(
      api: client,
      machine: 'host',
      input: input,
      recorder: mic,
    );
    await voice.start();
    expect(input.text, 'keep');
    expect(voice.active, isFalse);
    expect(voice.error, contains('麦克风权限'));
    voice.dispose();
    await Future<void>.delayed(Duration.zero);
    input.dispose();
  });
  test(
    'disconnect keeps streamed draft and disposal ignores late messages',
    () async {
      final client = api();
      addTearDown(client.close);
      final mic = Mic();
      late Session session;
      final input = TextEditingController(text: 'draft ');
      final voice = VoiceInput(
        api: client,
        machine: 'host',
        input: input,
        recorder: mic,
        sessionFactory: (receive) => session = Session(receive),
      );
      await voice.start();
      session.emit('partial', 0, '保留');
      session.onMessage({'type': 'error'});
      await Future<void>.delayed(Duration.zero);
      expect(input.text, 'draft 保留');
      expect(voice.active, isFalse);
      expect(voice.error, contains('已保留'));
      expect(session.closed, isTrue);
      voice.dispose();
      input.dispose();
      session.emit('final', 0, 'late');
      await Future<void>.delayed(Duration.zero);
      expect(mic.disposed, isTrue);
    },
  );
}
