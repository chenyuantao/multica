import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/asr_session.dart';
import 'package:web_socket_channel/io.dart';

void main() {
  test(
    'upgrade authenticates workspace/share; stop drains final before done',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      final errors = <Object>[];
      final pcmReceived = Completer<void>();
      server.listen((request) async {
        try {
          expect(request.headers.value('Authorization'), 'Bearer test-token');
          expect(
            request.headers.value('X-Workspace-ID'),
            '11111111-1111-4111-8111-111111111111',
          );
          expect(request.uri.queryParameters['share_machine'], 'testhost');
          expect(request.uri.queryParameters.containsKey('token'), isFalse);
          final socket = await WebSocketTransformer.upgrade(request);
          await for (final event in socket) {
            if (event is List<int>) {
              expect(event, [0, 0, 1, 0]);
              pcmReceived.complete();
              continue;
            }
            final message = jsonDecode(event as String) as Map;
            if (message['type'] == 'start') {
              expect(message, {
                'type': 'start',
                'sample_rate_hz': 16000,
                'format': 'pcm_s16le',
                'language': 'zh',
              });
              socket.add(jsonEncode({'type': 'ready'}));
            } else if (message['type'] == 'stop') {
              socket.add(
                jsonEncode({
                  'type': 'final',
                  'sentence_id': 0,
                  'start_ms': 120,
                  'end_ms': 650,
                  'text': '最后一句',
                }),
              );
              socket.add(jsonEncode({'type': 'done'}));
            }
          }
        } catch (error) {
          errors.add(error);
        }
      });
      final api = MulticaApi(baseUrl: 'http://127.0.0.1:${server.port}')
        ..token = 'test-token'
        ..workspaceId = '11111111-1111-4111-8111-111111111111';
      addTearDown(api.close);
      final messages = <Map<String, dynamic>>[];
      final session = AsrSession.connect(
        api: api,
        machine: 'testhost',
        onMessage: messages.add,
      );
      addTearDown(session.close);
      session.sendAudio([9, 0]);
      await session.start();
      session.sendAudio([0, 0, 1, 0]);
      await pcmReceived.future.timeout(const Duration(seconds: 2));
      await session.finish();
      expect(messages.single['text'], '最后一句');
      expect(errors, isEmpty);
    },
  );

  test('missing workspace fails before opening a socket', () {
    final api = MulticaApi(baseUrl: 'http://127.0.0.1:1')..token = 'token';
    addTearDown(api.close);
    expect(
      () => AsrSession.connect(api: api, machine: 'host', onMessage: (_) {}),
      throwsA(isA<ApiException>()),
    );
  });

  test('malformed event surfaces a controlled error', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      final socket = await WebSocketTransformer.upgrade(request);
      socket.listen((_) => socket.add('not JSON'));
    });
    final channel = IOWebSocketChannel.connect('ws://127.0.0.1:${server.port}');
    final messages = <Map<String, dynamic>>[];
    final session = AsrSession(channel: channel, onMessage: messages.add);
    addTearDown(session.close);
    await expectLater(session.start(), throwsA(isA<ApiException>()));
    expect(messages.single['message'], contains('格式错误'));
  });
}
