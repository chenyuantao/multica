/// Matches packages/views/im/im-utils.ts using the device's local calendar.
DateTime? chatLocalTime(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;

bool chatSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

bool needsChatTimeSeparator(Object? previous, Object? current) {
  final curr = chatLocalTime(current);
  if (curr == null) return false;
  final prev = chatLocalTime(previous);
  return prev == null ||
      !chatSameDay(prev, curr) ||
      curr.difference(prev) > const Duration(minutes: 5);
}

String chatTimeLabel(Object? current, {Object? previous, DateTime? now}) {
  final date = chatLocalTime(current);
  if (date == null) return '';
  final prev = chatLocalTime(previous);
  final today = (now ?? DateTime.now()).toLocal();
  String pad(int value) => value.toString().padLeft(2, '0');
  final clock = '${pad(date.hour)}:${pad(date.minute)}';
  if ((prev != null && chatSameDay(prev, date)) || chatSameDay(date, today)) {
    return clock;
  }
  final yesterday = DateTime(today.year, today.month, today.day - 1);
  if (chatSameDay(date, yesterday)) return '昨天 $clock';
  final monthDay = '${pad(date.month)}/${pad(date.day)}';
  return '${date.year == today.year ? monthDay : '${date.year}/$monthDay'} $clock';
}
