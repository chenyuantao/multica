class TranscriptSegment {
  const TranscriptSegment({
    required this.stamp,
    required this.text,
    this.startMs = 0,
  });

  final String stamp;
  final String text;
  final int startMs;

  /// `MM:SS` for the detail list. Milliseconds stay in [stamp].
  String get clock {
    final head = stamp.split('.').first;
    return head.length >= 5 ? head.substring(0, 5) : head;
  }
}

String stampFromMs(int ms) {
  if (ms < 0) ms = 0;
  final minutes = (ms ~/ 60000).toString().padLeft(2, '0');
  final seconds = ((ms ~/ 1000) % 60).toString().padLeft(2, '0');
  final millis = (ms % 1000).toString().padLeft(3, '0');
  return '$minutes:$seconds.$millis';
}

final _segment = RegExp(
  r'<!--\s*transcript:\s*(\d{2}:\d{2}(?:\.\d{1,3})?)\s*-->[ \t]*\r?\n?([^\n]*)',
);

List<TranscriptSegment> parseTranscript(String raw) {
  return [
    for (final match in _segment.allMatches(raw))
      TranscriptSegment(stamp: match.group(1)!, text: match.group(2)!.trim()),
  ];
}

String formatTranscript(Iterable<TranscriptSegment> lines) {
  return lines
      .map((line) => '<!-- transcript: ${line.stamp} -->\n${line.text}')
      .join('\n\n');
}
