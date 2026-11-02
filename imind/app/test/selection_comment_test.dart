import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/api.dart';
import 'package:imind_app/selection_comment.dart';

import 'voice_input_test.dart' show Mic, Session;

class _VoiceApi extends MulticaApi {
  _VoiceApi() : super(baseUrl: 'http://localhost', enableRealtime: false);
  @override
  Future<List<Map<String, dynamic>>> shares() async => [
    {'machine': 'host'},
  ];
}

class _CommentSession extends Session {
  _CommentSession(super.receive);
  @override
  Future<void> finish() async {
    await finalGate?.future;
    emit('final', 0, '解释得更具体');
  }
}

class _Flow {
  final api = _VoiceApi();
  final mic = Mic();
  late _CommentSession session;
  String? result;
  bool returned = false;

  Future<void> open(WidgetTester tester) async {
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                result = await showModalBottomSheet<String>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => SelectionCommentSheet(
                    markdown: '**选区**',
                    api: api,
                    machine: 'host',
                    voiceRecorder: mic,
                    voiceSessionFactory: (receive) =>
                        session = _CommentSession(receive),
                  ),
                );
                returned = true;
              },
              child: const Text('评论'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('评论'));
    await tester.pumpAndSettle();
  }

  TextEditingController input(WidgetTester tester) => tester
      .widget<TextField>(find.byKey(const ValueKey('ai-composer-input')))
      .controller!;
}

void main() {
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('com.llfbandit.record/messages'),
          (_) async => null,
        );
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('com.llfbandit.record/messages'),
          null,
        );
  });

  testWidgets(
    'selection composer dictates into the draft, drains final text, then stages it',
    (tester) async {
      final flow = _Flow();
      await flow.open(tester);
      expect(find.byTooltip('语音输入'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('ai-composer-input')),
        '请改写：',
      );
      await tester.tap(find.byTooltip('语音输入'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('停止语音输入'), findsOneWidget);
      expect(find.text('正在聆听，识别文字将填入输入框'), findsOneWidget);
      expect(
        tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (w) => w is IconButton && w.tooltip == '发送',
              ),
            )
            .onPressed,
        isNull,
      );
      flow.session.emit('partial', 0, '解释');
      await tester.pump();
      expect(flow.input(tester).text, '请改写：解释');
      flow.session.emit('partial', 0, '解释得更');
      await tester.pump();
      expect(flow.input(tester).text, '请改写：解释得更');
      flow.session.finalGate = Completer<void>();
      await tester.tap(find.byTooltip('停止语音输入'));
      await tester.pumpAndSettle();
      expect(find.text('正在完成识别…'), findsOneWidget);
      expect(flow.returned, isFalse);
      await tester.runAsync(() async {
        flow.session.finalGate!.complete();
        await Future<void>.delayed(Duration.zero);
      });
      await tester.pumpAndSettle();
      expect(flow.input(tester).text, '请改写：解释得更具体');
      expect(find.byTooltip('语音输入'), findsOneWidget);
      await tester.tap(find.byTooltip('发送'));
      await tester.pumpAndSettle();
      expect(flow.result, '请改写：解释得更具体');
      expect(flow.returned, isTrue);
      expect(flow.mic.stopped, isTrue);
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pumpAndSettle();
      expect(flow.mic.disposed, isTrue);
    },
  );

  testWidgets(
    'permission denial retains typed text; retry and outside dismiss release recording',
    (tester) async {
      final flow = _Flow();
      flow.mic.permission = false;
      await flow.open(tester);
      await tester.enterText(
        find.byKey(const ValueKey('ai-composer-input')),
        '保留草稿',
      );
      await tester.tap(find.byTooltip('语音输入'));
      await tester.pumpAndSettle();
      expect(find.textContaining('需要麦克风权限'), findsOneWidget);
      expect(flow.input(tester).text, '保留草稿');
      expect(flow.returned, isFalse);
      flow.mic.permission = true;
      await tester.tap(find.byTooltip('语音输入'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('停止语音输入'), findsOneWidget);
      flow.session.emit('partial', 0, '继续输入');
      await tester.pump();
      await tester.tapAt(const Offset(10, 80));
      await tester.pumpAndSettle();
      expect(flow.returned, isTrue);
      expect(flow.result, isNull);
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pumpAndSettle();
      expect(flow.session.closed, isTrue);
      expect(flow.mic.stopped, isTrue);
      expect(flow.mic.disposed, isTrue);
      flow.session.emit('final', 0, '关闭后到达');
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );
}
