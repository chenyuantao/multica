import 'package:flutter/services.dart';

class AgentMentionQuery {
  const AgentMentionQuery(this.start, this.end, this.query);
  final int start, end;
  final String query;
}

class _AgentMention {
  _AgentMention(this.start, this.end, this.id, this.name);
  int start, end;
  final String id, name;
}

/// Keeps the identity of each picked mention even when agents share a name.
class AgentMentionDraft {
  String _text = '';
  final _mentions = <_AgentMention>[];

  void update(String text) {
    if (_text == text) return;
    var start = 0;
    while (start < _text.length &&
        start < text.length &&
        _text[start] == text[start]) {
      start++;
    }
    var oldEnd = _text.length, newEnd = text.length;
    while (oldEnd > start &&
        newEnd > start &&
        _text[oldEnd - 1] == text[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    final delta = newEnd - oldEnd;
    _mentions.removeWhere((m) => m.start < oldEnd && m.end > start);
    for (final mention in _mentions) {
      if (mention.start >= oldEnd) {
        mention.start += delta;
        mention.end += delta;
      }
    }
    _text = text;
  }

  AgentMentionQuery? active(TextEditingValue value) {
    if (!value.selection.isValid ||
        !value.selection.isCollapsed ||
        (value.composing.isValid && !value.composing.isCollapsed)) {
      return null;
    }
    final caret = value.selection.extentOffset;
    if (caret > value.text.length ||
        _mentions.any((m) => caret > m.start && caret <= m.end)) {
      return null;
    }
    final match = RegExp(r'(^|\s)@([^\s@]*)$')
        .firstMatch(value.text.substring(0, caret));
    if (match == null) return null;
    return AgentMentionQuery(
      match.start + match.group(1)!.length,
      caret,
      match.group(2)!,
    );
  }

  TextEditingValue pick(TextEditingValue value, String id, String name) {
    final query = active(value);
    if (query == null) return value;
    final token = '@$name';
    final text = value.text.replaceRange(query.start, query.end, '$token ');
    update(text);
    _mentions.add(
      _AgentMention(query.start, query.start + token.length, id, name),
    );
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(
        offset: query.start + token.length + 1,
      ),
    );
  }

  String encode(String text) {
    update(text);
    var result = text;
    for (final mention in [
      ..._mentions,
    ]..sort((a, b) => b.start.compareTo(a.start))) {
      if (text.substring(mention.start, mention.end) != '@${mention.name}') {
        continue;
      }
      // Extending a picked name makes it ordinary text rather than another agent.
      if (mention.end < text.length &&
          !RegExp(r'[\s.,;:!?，。；：！？]').hasMatch(text[mention.end])) {
        continue;
      }
      final label = '@${mention.name}'.replaceAllMapped(
        RegExp(r'[\\\[\]]'),
        (m) => '\\${m[0]}',
      );
      result = result.replaceRange(
        mention.start,
        mention.end,
        '[$label](mention://agent/${mention.id})',
      );
    }
    return result;
  }
}
