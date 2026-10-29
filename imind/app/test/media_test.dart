import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/media.dart';

void main() {
  test('PCM is wrapped as a valid little endian mono WAV and keeps bytes', () {
    final wav = pcm16MonoWav([1, 2, 3, 4]);
    expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
    expect(String.fromCharCodes(wav.sublist(8, 12)), 'WAVE');
    expect(wav[24], 0x80); // 16000 Hz low byte
    expect(wav[25], 0x3e);
    expect(wav.sublist(44), [1, 2, 3, 4]);
  });

  test('markdown media path is limited to its note identity', () {
    const id = '4e2c1478-6f08-43d8-a949-e07ccf778d99';
    expect(
      imindMediaName('media/$id/abc1234567890123.jpg', id),
      'abc1234567890123.jpg',
    );
    expect(imindMediaName('media/$id-other/abc1234567890123.jpg', id), isNull);
    expect(imindMediaName('media/$id/../../secret.jpg', id), isNull);
  });
}
