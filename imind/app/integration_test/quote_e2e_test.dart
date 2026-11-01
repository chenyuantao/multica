import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/quote_flow.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('article selection through queued quotes to explicit chat send', (
    tester,
  ) async {
    await runQuoteFlow(
      tester,
      capture: (name) async {
        debugPrint('QUOTE_CAPTURE: $name');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 3)),
        );
      },
    );
  });
  testWidgets(
    'tap marks, multi-select, delete and explicitly cancel the mode',
    (tester) async {
      await runMarkDeletionFlow(
        tester,
        capture: (name) async {
          debugPrint('QUOTE_CAPTURE: $name');
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(seconds: 3)),
          );
        },
      );
    },
  );
}
