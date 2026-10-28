import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/url_extract.dart';

void main() {
  test('extracts the first url and drops trailing punctuation', () {
    expect(
      firstUrl('看看这篇 https://mp.weixin.qq.com/s/9xK2hF，还有别的'),
      'https://mp.weixin.qq.com/s/9xK2hF',
    );
    expect(firstUrl('没有链接'), isNull);
  });
  test('handles mixed Chinese prose, balanced parentheses and queries', () {
    expect(firstUrl('链接：https://example.com/a。后面还有话'), 'https://example.com/a');
    expect(
      firstUrl('(https://example.com/wiki/Test_(item))'),
      'https://example.com/wiki/Test_(item)',
    );
    expect(
      firstUrl('HTTPS://example.com/a?q=one&x=two#part'),
      'HTTPS://example.com/a?q=one&x=two#part',
    );
    expect(
      firstUrl('https://example.com/first https://example.com/second'),
      'https://example.com/first',
    );
    expect(firstUrl('file:///private/data'), isNull);
    expect(firstUrl('https://user:password@example.com'), isNull);
    expect(firstUrl('https://'), isNull);
  });
}
