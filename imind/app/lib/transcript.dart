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
    return head;
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
  r'<!--\s*transcript:\s*(\d{2,}:[0-5]\d(?:\.\d{1,3})?)\s*-->',
);

List<TranscriptSegment> parseTranscript(String raw) {
  final matches = _segment.allMatches(raw).toList();
  return [
    for (var index = 0; index < matches.length; index++)
      TranscriptSegment(
        stamp: matches[index].group(1)!,
        text: raw
            .substring(
              matches[index].end,
              index + 1 < matches.length
                  ? matches[index + 1].start
                  : raw.length,
            )
            .trim(),
        startMs: _stampToMs(matches[index].group(1)!),
      ),
  ];
}

int _stampToMs(String stamp) {
  final parts = stamp.split(RegExp(r'[:.]'));
  return int.parse(parts[0]) * 60000 +
      int.parse(parts[1]) * 1000 +
      (parts.length > 2 ? int.parse(parts[2].padRight(3, '0')) : 0);
}

String formatTranscript(Iterable<TranscriptSegment> lines) {
  return lines
      .map((line) => '<!-- transcript: ${line.stamp} -->\n${line.text}')
      .join('\n\n');
}
