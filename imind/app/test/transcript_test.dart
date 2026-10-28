import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/transcript.dart';

void main() {
  test('keeps multiline Markdown and millisecond timestamps on round trip', () {
    const raw =
        '<!-- transcript: 00:01.200 -->\n第一行\n\n**第二行**\n\n'
        '<!-- transcript: 12:30.04 -->\n结尾';
    final segments = parseTranscript(raw);
    expect(segments[0].text, '第一行\n\n**第二行**');
    expect(segments[0].startMs, 1200);
    expect(segments[1].startMs, 750040);
    expect(formatTranscript(segments), raw);
  });
  test('supports long recordings without truncating clocks', () {
    expect(stampFromMs(6000000), '100:00.000');
    final segment = parseTranscript('<!-- transcript: 100:00.000 -->\n长录音')
        .single;
    expect(segment.clock, '100:00');
    expect(segment.startMs, 6000000);
  });
  test('empty transcript and invalid timestamps have no segments', () {
    expect(parseTranscript(''), isEmpty);
    expect(parseTranscript('<!-- transcript: 00:99 -->\ninvalid'), isEmpty);
    expect(stampFromMs(-1), '00:00.000');
  });
}
