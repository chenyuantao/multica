import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:imind_app/debug_update.dart';

final source = Uri.parse(
  'https://github.com/owner/repo/releases/download/imind-debug/version.json',
);
Map<String, Object> manifest() => {
  'application_id': 'ai.multica.imind_app',
  'channel': 'imind-debug',
  'version_code': 1002,
  'version_name': '1.0.0-debug.1002',
  'apk_url': 'https://github.com/owner/repo/releases/download/imind-debug-1002/imind-debug.apk',
  'sha256': 'a' * 64,
  'size': 1024,
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('imind/debug_update');
  late List<MethodCall> calls;
  late int installed;
  late String installResult;
  late int status;
  late String body;
  late bool failDownload;
  Completer<void>? download;
  late DebugUpdateService service;

  setUp(() {
    calls = [];
    installed = 1001;
    installResult = 'installer_opened';
    status = 200;
    body = jsonEncode(manifest());
    failDownload = false;
    download = null;
    service = DebugUpdateService(
      manifest: source,
      client: MockClient((request) async {
        expect(request.url, source);
        expect(request.headers['Cache-Control'], 'no-cache');
        return http.Response(body, status);
      }),
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          switch (call.method) {
            case 'versionCode':
              return installed;
            case 'download':
              if (failDownload) {
                throw PlatformException(code: 'download_failed');
              }
              await download?.future;
              return null;
            case 'install':
              return installResult;
            case 'cancel':
              return null;
            default:
              throw MissingPluginException();
          }
        });
  });

  tearDown(() {
    service.close();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test(
    'offers only newer builds; missing channel is allowed before first release',
    () async {
      expect((await service.check())!.versionCode, 1002);
      for (final code in [1002, 1003]) {
        installed = code;
        expect(await service.check(), isNull);
      }
      status = 404;
      expect(await service.check(), isNull);
    },
  );

  test(
    'rejects malformed metadata and APKs outside the exact repository release',
    () async {
      for (final patch in <Map<String, Object?>>[
        {'application_id': 'other.app'},
        {'channel': 'stable'},
        {'version_code': '1002'},
        {'version_code': -1},
        {'version_code': 2100000001},
        {'version_name': null},
        {'sha256': 'invalid'},
        {'size': 0},
        {'size': 513 * 1024 * 1024},
        {
          'apk_url': 'http://github.com/owner/repo/releases/download/imind-debug-1002/imind-debug.apk',
        },
        {
          'apk_url': 'https://github.com/other/repo/releases/download/imind-debug-1002/imind-debug.apk',
        },
        {
          'apk_url': 'https://github.com/owner/repo/releases/download/imind-debug-1001/imind-debug.apk',
        },
        {
          'apk_url': 'https://github.com/owner/repo/releases/download/imind-debug-1002/imind-debug.apk?token=secret',
        },
      ]) {
        body = jsonEncode({...manifest(), ...patch});
        await expectLater(
          service.check(),
          throwsFormatException,
          reason: '$patch',
        );
      }
      for (final response in ['not json', '[]', '{}']) {
        body = response;
        await expectLater(service.check(), throwsFormatException);
      }
      status = 500;
      await expectLater(service.check(), throwsFormatException);
    },
  );

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: DebugUpdateGate(
          service: service,
          child: const Scaffold(body: Text('Notes')),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'startup download forwards verification metadata and resumes after permission settings',
    (tester) async {
      installResult = 'permission_required';
      await open(tester);
      expect(find.text('发现新版本 1.0.0-debug.1002'), findsOneWidget);
      expect(calls.map((call) => call.method), ['versionCode']);
      await tester.tap(find.text('下载更新'));
      await tester.pumpAndSettle();
      final args =
          calls.firstWhere((call) => call.method == 'download').arguments
              as Map;
      expect(args['url'], manifest()['apk_url']);
      expect(args['sha256'], manifest()['sha256']);
      expect(args['size'], 1024);
      expect(args['versionCode'], 1002);
      expect(find.textContaining('请允许 iMind 安装应用'), findsOneWidget);
      installResult = 'installer_opened';
      await tester.tap(find.text('继续安装'));
      await tester.pumpAndSettle();
      expect(calls.where((call) => call.method == 'download'), hasLength(1));
      expect(calls.where((call) => call.method == 'install'), hasLength(2));
      expect(find.textContaining('请在系统界面确认安装'), findsOneWidget);
    },
  );

  testWidgets('failed verification never opens installer and allows retry', (
    tester,
  ) async {
    failDownload = true;
    await open(tester);
    await tester.tap(find.text('下载更新'));
    await tester.pumpAndSettle();
    expect(find.text('下载或校验失败，请重试。'), findsOneWidget);
    expect(calls.where((call) => call.method == 'install'), isEmpty);
    failDownload = false;
    await tester.tap(find.text('下载更新'));
    await tester.pumpAndSettle();
    expect(calls.where((call) => call.method == 'install'), hasLength(1));
  });

  testWidgets(
    'cancel during download prevents a late completion from opening installer',
    (tester) async {
      download = Completer<void>();
      await open(tester);
      await tester.tap(find.text('下载更新'));
      await tester.pump();
      await tester.tap(find.text('取消下载'));
      await tester.pumpAndSettle();
      download!.complete();
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Notes'), findsOneWidget);
      expect(calls.where((call) => call.method == 'cancel'), hasLength(1));
      expect(calls.where((call) => call.method == 'install'), isEmpty);
    },
  );

  testWidgets('unavailable source leaves the app usable', (tester) async {
    status = 503;
    await open(tester);
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('Notes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
