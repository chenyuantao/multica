import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image_picker/image_picker.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/media.dart';

const id = '22222222-2222-4222-8222-222222222222';
final png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
);

class Picker extends ImagePicker {
  Picker(this.action);
  final Future<XFile?> Function() action;
  @override
  Future<XFile?> pickImage({
    required ImageSource source,
    double? maxWidth,
    double? maxHeight,
    int? imageQuality,
    CameraDevice preferredCameraDevice = CameraDevice.rear,
    bool requestFullMetadata = true,
  }) => action();
}

void main() {
  testWidgets('new notes open in edit mode', (tester) async {
    final api = MulticaApi(
      baseUrl: 'http://localhost',
      client: MockClient((_) async => http.Response('{}', 200)),
    );
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: NoteEditor(api: api, machine: 'mbp'),
      ),
    );
    expect(find.byType(TextField), findsNWidgets(2));
    expect(find.text('保存'), findsOneWidget);
    expect(find.byTooltip('语音输入'), findsOneWidget);
  });

  testWidgets('shared image opens native viewer with authenticated bytes', (
    tester,
  ) async {
    final api =
        MulticaApi(
            baseUrl: 'http://localhost',
            client: MockClient((_) async => http.Response.bytes(png, 200)),
          )
          ..token = 'token'
          ..workspaceId = '11111111-1111-4111-8111-111111111111';
    addTearDown(api.close);
    MethodCall? call;
    const channel = MethodChannel('imind/image_viewer');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (value) async {
          call = value;
          return null;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: IMindMarkdown(
            data: '![图片](media/$id/aaaaaaaaaaaaaaaa.png)',
            api: api,
            machine: 'mbp',
            noteId: id,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final gesture = tester.widget<GestureDetector>(
      find
          .ancestor(
            of: find.byType(Image),
            matching: find.byWidgetPredicate(
              (w) => w is GestureDetector && w.onTap != null,
            ),
          )
          .first,
    );
    gesture.onTap!();
    await tester.pumpAndSettle();
    expect(call?.method, 'open');
    expect(call?.arguments['bytes'], png);
    expect(call?.arguments['extension'], 'png');
  });

  for (final outcome in ['cancel', 'denied', 'upload-failed', 'success']) {
    testWidgets(
      'image selection $outcome preserves draft and uses durable reference',
      (tester) async {
        var uploads = 0;
        var saved = <String, dynamic>{
          'id': id,
          'revision': 'r',
          'title': 'Photo note',
          'content': 'Original text',
          'tags': <String>[],
          'type': 'note',
        };
        final api =
            MulticaApi(
                baseUrl: 'http://localhost',
                client: MockClient((request) async {
                  if (request.url.path == '/api/imind/media') {
                    uploads++;
                    expect(request.bodyBytes, png);
                    return http.Response(
                      '',
                      outcome == 'upload-failed' ? 503 : 201,
                    );
                  }
                  if (request.method == 'PUT') {
                    saved = {
                      ...saved,
                      ...jsonDecode(request.body) as Map<String, dynamic>,
                      'revision': 'r2',
                    };
                  }
                  if (request.method == 'GET' &&
                      request.url.path.contains('/media/')) {
                    return http.Response.bytes(png, 200);
                  }
                  return http.Response(jsonEncode(saved), 200);
                }),
              )
              ..token = 'token'
              ..workspaceId = '11111111-1111-4111-8111-111111111111';
        addTearDown(api.close);
        final picker = Picker(() async {
          if (outcome == 'cancel') return null;
          if (outcome == 'denied') {
            throw PlatformException(code: 'photo_access_denied');
          }
          return XFile.fromData(
            Uint8List.fromList(png),
            mimeType: 'image/png',
            name: 'fixture.png',
          );
        });
        await tester.pumpWidget(
          MaterialApp(
            home: NoteEditor(
              api: api,
              machine: 'mbp',
              note: saved,
              imagePicker: picker,
            ),
          ),
        );
        await tester.tap(find.byTooltip('更多'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('编辑'));
        await tester.pumpAndSettle();
        await tester.pump(const Duration(seconds: 1));
        await tester.tap(find.text('选图'));
        await tester.pumpAndSettle();
        final body = tester
            .widget<TextField>(find.byType(TextField).last)
            .controller!;
        expect(body.text, contains('Original text'));
        if (outcome == 'success') {
          expect(body.text, contains('media/$id/'));
          expect(body.text, isNot(contains('pending:')));
          await tester.pump(const Duration(seconds: 1));
          await tester.tap(find.byTooltip('撤销'));
          await tester.pumpAndSettle();
          expect(body.text, 'Original text');
          await tester.tap(find.byTooltip('重做'));
          await tester.pumpAndSettle();
          expect(body.text, contains('media/$id/'));
          await tester.tap(find.text('保存'));
          await tester.pumpAndSettle();
          expect(saved['content'], contains('media/$id/'));
        } else {
          expect(body.text, 'Original text');
          expect(uploads, outcome == 'upload-failed' ? 1 : 0);
          if (outcome != 'cancel') {
            expect(find.textContaining('原有文字已保留'), findsOneWidget);
          }
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
}
