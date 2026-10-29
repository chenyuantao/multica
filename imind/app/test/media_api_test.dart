import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/api.dart';

const _workspace = '11111111-1111-4111-8111-111111111111';
const _note = '22222222-2222-4222-8222-222222222222';
const _name = 'aabbccddeeff00112233445566778899.jpg';

MulticaApi _api(http.Client client) =>
    MulticaApi(
        baseUrl: 'http://localhost',
        client: client,
        onUnauthorized: () async {},
      )
      ..token = 'session-a'
      ..workspaceId = _workspace;

void main() {
  test('media GET sends authorization without following redirects', () async {
    late http.Request seen;
    final api = _api(
      MockClient((request) async {
        seen = request;
        return http.Response.bytes([1, 2, 3], 200);
      }),
    );
    expect(await api.getMedia(machine: 'mbp', noteId: _note, name: _name), [
      1,
      2,
      3,
    ]);
    expect(seen.followRedirects, isFalse);
    expect(seen.headers['Authorization'], 'Bearer session-a');
    expect(seen.headers['X-Workspace-ID'], _workspace);
  });

  test('media upload streams raw bytes instead of base64 JSON', () async {
    late http.Request seen;
    final api = _api(
      MockClient((request) async {
        seen = request;
        return http.Response('', 201);
      }),
    );
    await api.uploadMedia(
      machine: 'mbp',
      noteId: _note,
      name: 'audio.wav',
      contentType: 'audio/wav',
      bytes: Uint8List.fromList([1, 2, 3]),
    );
    expect(seen.followRedirects, isFalse);
    expect(seen.headers['Content-Type'], 'audio/wav');
    expect(seen.headers['Authorization'], 'Bearer session-a');
    expect(seen.bodyBytes, [1, 2, 3]);
    expect(seen.url.queryParameters['share_machine'], 'mbp');
  });

  test(
    'media GET rejects a response after account or workspace changes',
    () async {
      final response = Completer<http.Response>();
      final api = _api(MockClient((_) => response.future));
      final pending = api.getMedia(machine: 'mbp', noteId: _note, name: _name);
      api.token = 'session-b';
      response.complete(http.Response.bytes([9], 200));
      await expectLater(
        pending,
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      );
    },
  );

  test('stale 401 cannot revoke a newer session', () async {
    final response = Completer<http.Response>();
    var unauthorized = 0;
    final api = _api(MockClient((_) => response.future))
      ..onUnauthorized = () async {
        unauthorized++;
      };
    final pending = api.getMedia(machine: 'mbp', noteId: _note, name: _name);
    api.token = 'session-b';
    response.complete(http.Response('unauthorized', 401));
    await expectLater(pending, throwsA(isA<ApiException>()));
    expect(api.token, 'session-b');
    expect(unauthorized, 0);
  });
}
