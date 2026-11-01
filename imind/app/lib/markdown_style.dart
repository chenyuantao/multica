import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

/// Scales every Markdown text role from its original size.
MarkdownStyleSheet imindMarkdownStyle(
  BuildContext context, {
  Color? textColor,
  double? bodyFontSize,
  double? bodyHeight,
}) {
  const scale = 1.2;
  final theme = Theme.of(context);
  final style = MarkdownStyleSheet.fromTheme(
    theme.copyWith(textTheme: theme.textTheme.apply(fontSizeFactor: scale)),
  );
  return style.copyWith(
    p: style.p!.copyWith(
      color: textColor,
      fontSize: bodyFontSize == null ? null : bodyFontSize * scale,
      height: bodyHeight,
    ),
  );
}
