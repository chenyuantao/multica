import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:markdown/markdown.dart' as md;

class NoteQuote {
  NoteQuote({
    required this.number,
    required this.start,
    required this.end,
    required this.markdown,
    required this.instruction,
  });
  final int number;
  final int start;
  final int end;
  final String markdown;
  final String instruction;
  bool pending = true;
}

/// A detail-screen draft. Sent anchors remain visible until the detail closes.
class NoteQuoteDraft extends ChangeNotifier {
  final _quotes = <NoteQuote>[];
  int _nextNumber = 1;
  String? _source;
  void bindSource(String source) {
    if (_source != null && _source != source) {
      clear();
    }
    _source = source;
  }

  List<NoteQuote> get quotes => List.unmodifiable(_quotes);
  List<NoteQuote> get pending => _quotes.where((q) => q.pending).toList();
  void add(int start, int end, String markdown, String instruction) {
    _quotes.add(
      NoteQuote(
        number: _nextNumber++,
        start: start,
        end: end,
        markdown: markdown,
        instruction: instruction.trim(),
      ),
    );
    notifyListeners();
  }

  void remove(NoteQuote quote) {
    _quotes.remove(quote);
    notifyListeners();
  }

  void markSent(List<NoteQuote> sent) {
    for (final quote in sent) {
      quote.pending = false;
    }
    notifyListeners();
  }

  void clear() {
    _quotes.clear();
    notifyListeners();
  }

  String compose(String message) {
    if (pending.isEmpty) return message.trim();
    return [
      ...pending.map((q) => '【“${q.markdown}”+用户指令：“${q.instruction}”】'),
      if (message.trim().isNotEmpty) message.trim(),
    ].join('\n\n---------\n\n');
  }
}

class _Part {
  _Part(this.node, this.start, this.end, this.children);
  final md.Node node;
  final int start;
  final int end;
  final List<_Part> children;
}

/// Rendered-text offsets and a semantic Markdown slice share one parsed tree.
/// Slicing a styled fragment restores its enclosing Markdown syntax.
class MarkdownSelectionDocument {
  MarkdownSelectionDocument(String markdown) {
    final nodes = md.Document(extensionSet: md.ExtensionSet.gitHubFlavored)
        .parseLines(markdown.split('\n'));
    for (final node in nodes) {
      _parts.add(_index(node));
    }
    plainText = _plain.toString();
  }
  final _plain = StringBuffer();
  final _parts = <_Part>[];
  late final String plainText;
  static const _blocks = {
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'blockquote',
    'pre',
    'tr',
  };
  _Part _index(md.Node node, [bool code = false]) {
    final start = _plain.length;
    final children = <_Part>[];
    if (node is md.Text) {
      _plain.write(
        code ? node.text : node.text.replaceAll(RegExp(r' ?\n *'), ' '),
      );
    } else if (node is md.Element) {
      if (node.tag == 'br') _plain.write('\n');
      if (node.tag != 'img') {
        for (final child in node.children ?? <md.Node>[]) {
          children.add(_index(child, code || node.tag == 'pre'));
        }
      }
    }
    final end = _plain.length;
    if (node is md.Element && _blocks.contains(node.tag)) _plain.write('\n');
    return _Part(node, start, end, children);
  }

  String slice(int start, int end) => _parts
      .map((p) => _slice(p, start, end))
      .where((s) => s.isNotEmpty)
      .join('\n\n')
      .trim();
  String _slice(_Part part, int start, int end) {
    if (end <= part.start || start >= part.end) return '';
    final node = part.node;
    if (node is md.Text) {
      final text = plainText.substring(
        math.max(start, part.start),
        math.min(end, part.end),
      );
      // Escaping keeps literal punctuation literal after pasting Markdown.
      return text.replaceAllMapped(
        RegExp(r'([\\`*_\[\]<>~|#!])'),
        (m) => '\\${m[0]}',
      );
    }
    node as md.Element;
    if (node.tag == 'br') return '\n';
    if (node.tag == 'pre' || node.tag == 'code') {
      final text = plainText.substring(
        math.max(start, part.start),
        math.min(end, part.end),
      );
      var fence = '`';
      while (text.contains(fence)) {
        fence += '`';
      }
      if (node.tag == 'pre') {
        if (fence.length < 3) fence = '```';
        final code = node.children?.firstOrNull;
        final language = code is md.Element
            ? (code.attributes['class'] ?? '').replaceFirst('language-', '')
            : '';
        return '$fence$language\n$text\n$fence';
      }
      return '$fence $text $fence';
    }
    if (node.tag == 'ol') {
      final first = int.tryParse(node.attributes['start'] ?? '') ?? 1;
      return [
        for (var i = 0; i < part.children.length; i++)
          _slice(
            part.children[i],
            start,
            end,
          ).replaceFirst(RegExp(r'^- '), '${first + i}. '),
      ].where((s) => s.isNotEmpty).join('\n');
    }
    if (node.tag == 'table') {
      final rows = <String>[];
      void row(_Part p) {
        if (p.node is md.Element && (p.node as md.Element).tag == 'tr') {
          final cells = p.children.map((c) => _slice(c, start, end)).toList();
          if (cells.any((c) => c.isNotEmpty)) {
            rows.add('| ${cells.join(' | ')} |');
            if (rows.length == 1) {
              rows.add('| ${List.filled(cells.length, '---').join(' | ')} |');
            }
          }
        } else {
          for (final child in p.children) {
            row(child);
          }
        }
      }

      row(part);
      return rows.join('\n');
    }
    final body = part.children
        .map((p) => _slice(p, start, end))
        .where((s) => s.isNotEmpty)
        .join(
          node.tag == 'ul' || node.tag == 'ol' || node.tag == 'blockquote'
              ? '\n'
              : '',
        );
    if (body.isEmpty) return '';
    switch (node.tag) {
      case 'strong':
        return '**$body**';
      case 'em':
        return '*$body*';
      case 'del':
        return '~~$body~~';
      case 'a':
        return '[$body](${node.attributes['href'] ?? ''})';
      case 'blockquote':
        return body.split('\n').map((line) => '> $line').join('\n');
      case 'li':
        return '- $body';
      default:
        if (RegExp(r'^h[1-6]$').hasMatch(node.tag)) {
          return '${'#' * int.parse(node.tag[1])} $body';
        }
        return body;
    }
  }
}
