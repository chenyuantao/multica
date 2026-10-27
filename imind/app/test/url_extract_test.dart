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
}
