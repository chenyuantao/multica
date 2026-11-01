import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/chat_time.dart';

void main() {
  String at(int day, int hour, int minute, {int year = 2026}) =>
      DateTime(year, 10, day, hour, minute).toIso8601String();

  test(
    'separators match web: first, new day, or strictly over five minutes',
    () {
      expect(needsChatTimeSeparator(null, at(31, 10, 0)), isTrue);
      expect(needsChatTimeSeparator(at(31, 10, 0), at(31, 10, 5)), isFalse);
      expect(needsChatTimeSeparator(at(31, 10, 0), at(31, 10, 6)), isTrue);
      expect(needsChatTimeSeparator(at(30, 23, 59), at(31, 0, 0)), isTrue);
      expect(needsChatTimeSeparator(null, 'invalid'), isFalse);
    },
  );

  test(
    'local calendar labels match web including same-day repeated separators',
    () {
      final now = DateTime(2026, 10, 31, 12);
      expect(chatTimeLabel(at(31, 9, 5), now: now), '09:05');
      expect(chatTimeLabel(at(30, 9, 5), now: now), '昨天 09:05');
      expect(chatTimeLabel(at(29, 9, 5), now: now), '10/29 09:05');
      expect(
        chatTimeLabel(at(29, 9, 5, year: 2025), now: now),
        '2025/10/29 09:05',
      );
      expect(
        chatTimeLabel(at(30, 9, 15), previous: at(30, 9, 5), now: now),
        '09:15',
      );
      expect(chatTimeLabel('invalid', now: now), '');
      final utc = DateTime(2026, 10, 31, 9, 5).toUtc().toIso8601String();
      expect(chatTimeLabel(utc, now: now), '09:05');
    },
  );
}
