import 'dart:convert';
import 'dart:io';

import 'package:integration_test/integration_test_driver.dart';

Future<void> main() => integrationDriver(
  responseDataCallback: (data) async {
    final directory = Directory(
      Platform.environment['IMIND_NAVIGATION_OUTPUT'] ??
          '../../outputs/imind/navigation',
    );
    await directory.create(recursive: true);
    final screenshots = Map<String, dynamic>.from(
      data!['ui_screenshots'] as Map,
    );
    for (final entry in screenshots.entries) {
      await File('${directory.path}/${entry.key}.png')
          .writeAsBytes(base64Decode(entry.value as String));
    }
  },
);
