final _urlPattern = RegExp(
  r'''https?://[^\s<>"'\[\]，。；！？、（）《》“”‘’]+''',
  caseSensitive: false,
);

/// Returns the first http(s) URL in [text], without trailing punctuation.
String? firstUrl(String text) {
  final match = _urlPattern.firstMatch(text);
  if (match == null) return null;
  var value = match.group(0)!.replaceAll(RegExp(r'[,.;:!?]+$'), '');
  while (value.endsWith(')') &&
      ')'.allMatches(value).length > '('.allMatches(value).length) {
    value = value.substring(0, value.length - 1);
  }
  final uri = Uri.tryParse(value);
  if (uri == null || uri.host.isEmpty || uri.userInfo.isNotEmpty) return null;
  return value;
}
