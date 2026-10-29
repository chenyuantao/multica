import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:imind_app/api.dart';
import 'package:imind_app/main.dart';
import 'package:imind_app/session.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'local Docker: email OTP, wrong code, logout, login and secure restore',
    (tester) async {
      const email = String.fromEnvironment('E2E_LOGIN_EMAIL');
      const bridge = String.fromEnvironment('E2E_LOGIN_BRIDGE');
      const nonce = String.fromEnvironment('E2E_LOGIN_NONCE');
      const restoreOnly = bool.fromEnvironment('E2E_LOGIN_RESTORE');
      expect(email.startsWith('imind-login-e2e'), isTrue);
      final store = SessionStore();
      final client = http.Client();
      addTearDown(client.close);

      Future<Map<String, dynamic>> host(String path) async {
        final response = await tester.runAsync(
          () => client
              .get(
                Uri.parse('$bridge$path'),
                headers: {'Authorization': 'Bearer $nonce'},
              )
              .timeout(const Duration(seconds: 90)),
        );
        if (response == null || response.statusCode != 200) {
          fail('Local Docker OTP bridge failed');
        }
        return jsonDecode(response.body) as Map<String, dynamic>;
      }

      Future<void> waitFor(Finder finder) async {
        for (var i = 0; i < 150; i++) {
          await tester.pump(const Duration(milliseconds: 200));
          if (finder.evaluate().isNotEmpty) return;
        }
        expect(finder, findsWidgets);
      }

      Future<void> home() async {
        await waitFor(find.byTooltip('菜单'));
        expect(find.widgetWithText(PillButton, '笔记'), findsOneWidget);
        expect(find.widgetWithText(PillButton, '录音'), findsOneWidget);
        for (var i = 0; i < 150; i++) {
          await tester.pump(const Duration(milliseconds: 200));
          final session = await store.read(defaultApiBase());
          if (session?.workspaceId != null &&
              session?.machine != null &&
              find.byType(CircularProgressIndicator).evaluate().isEmpty) {
            return;
          }
        }
        fail('Authenticated home did not finish workspace/share bootstrap');
      }

      Future<void> login({required bool wrongCode}) async {
        await waitFor(find.text('发送验证码'));
        await tester.enterText(find.byType(TextField).first, email);
        await host('/begin');
        await tester.tap(find.text('发送验证码'));
        await waitFor(find.text('验证码'));
        final payload = await host('/code');
        final code = payload['code'] as String;
        if (wrongCode) {
          final wrong = code == '000000' ? '111111' : '000000';
          await tester.enterText(find.byType(TextField).last, wrong);
          await tester.tap(find.widgetWithText(FilledButton, '登录'));
          await waitFor(
            find.byWidgetPredicate(
              (widget) =>
                  widget is Text &&
                  (widget.data?.contains('invalid') == true ||
                      widget.data?.contains('验证码') == true) &&
                  widget.style?.color == const Color(0xFFE5484D),
            ),
          );
          expect(find.byType(LoginPage), findsOneWidget);
        }
        await tester.enterText(find.byType(TextField).last, code);
        await tester.tap(find.widgetWithText(FilledButton, '登录'));
        await home();
      }

      if (restoreOnly) {
        await tester.pumpWidget(IMindApp(sessionStore: store));
        await home();
        debugPrint('E2E_LOGIN: persisted secure session restored');
        return;
      }
      await store.clear();
      await tester.pumpWidget(IMindApp(sessionStore: store));
      await login(wrongCode: true);
      debugPrint(
        'E2E_LOGIN: real send-code/verify-code and wrong-code feedback passed',
      );
      final data = await store.read(defaultApiBase());
      expect(data?.workspaceId, isNotNull);
      expect(data?.machine, isNotNull);
      final api = MulticaApi(baseUrl: defaultApiBase())
        ..token = data!.token
        ..workspaceId = data.workspaceId;
      addTearDown(api.close);
      final title = 'OTP E2E ${DateTime.now().millisecondsSinceEpoch}';
      final note = await tester.runAsync(
        () => api.createNote({
          'share_machine': data.machine,
          'type': 'note',
          'title': title,
          'content': 'OTP authenticated note read/write',
        }),
      );
      expect(note, isNotNull);
      // Open the same persisted note through the authenticated App UI.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.pumpWidget(IMindApp(sessionStore: store));
      await waitFor(find.text(title));
      await tester.tap(find.text(title));
      await waitFor(find.text('OTP authenticated note read/write'));
      await tester.tap(find.text('OTP authenticated note read/write'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField).last,
        'OTP note edited in App',
      );
      await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();
      await waitFor(find.byTooltip('返回'));
      expect(tester.takeException(), isNull);
      final saved = await tester.runAsync(
        () => api.getNote(data.machine!, note!['id'] as String),
      );
      expect(saved?['content'], 'OTP note edited in App');
      await tester.tap(find.byTooltip('返回'));
      await tester.pumpAndSettle();
      await home();
      await tester.tap(find.byTooltip('菜单'));
      await tester.pumpAndSettle();
      await waitFor(find.byTooltip('退出登录'));
      await tester.tap(find.byTooltip('退出登录'));
      await waitFor(find.text('发送验证码'));
      expect(await store.read(defaultApiBase()), isNull);
      await login(wrongCode: false);
      debugPrint(
        'E2E_LOGIN: note read/write, logout and second OTP login passed',
      );
    },
    timeout: const Timeout(Duration(minutes: 6)),
  );
}
