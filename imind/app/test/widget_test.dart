import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/main.dart';

void main() {
  testWidgets('login is the signed-out home', (tester) async {
    await tester.pumpWidget(const IMindApp(initialToken: ''));
    expect(find.text('发送验证码'), findsOneWidget);
    expect(find.text('在这里，记录你的一切。'), findsOneWidget);
  });
}
