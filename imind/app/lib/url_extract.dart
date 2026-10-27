final _urlPattern = RegExp(r'https?://[^\s<>"\]]+', caseSensitive: false);

/// Returns the first http(s) URL in [text], without trailing punctuation.
String? firstUrl(String text) {
  final match = _urlPattern.firstMatch(text);
  if (match == null) return null;
  return match.group(0)!.replaceAll(RegExp(r'[),.;，。；]+$'), '');
}
