import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import 'ai_composer.dart';
import 'media.dart';
import 'api.dart';
import 'note_quotes.dart';

class _ParagraphRange {
  _ParagraphRange(this.paragraph, this.start, this.contentStart);
  final RenderParagraph paragraph;
  final int start;
  final int contentStart;
}

/// Keeps the existing Markdown renderer, image handling and cross-block selection.
class QuotedMarkdown extends StatefulWidget {
  const QuotedMarkdown({
    super.key,
    required this.data,
    required this.draft,
    this.api,
    this.machine,
    this.noteId,
  });
  final String data;
  final NoteQuoteDraft draft;
  final MulticaApi? api;
  final String? machine;
  final String? noteId;
  @override
  State<QuotedMarkdown> createState() => _QuotedMarkdownState();
}

class _QuotedMarkdownState extends State<QuotedMarkdown> {
  final _contentKey = GlobalKey();
  final _selectionNotifier = SelectionListenerNotifier();
  late MarkdownSelectionDocument _document;
  @override
  void initState() {
    super.initState();
    _document = MarkdownSelectionDocument(widget.data);
    widget.draft.bindSource(widget.data);
    widget.draft.addListener(_refresh);
  }

  @override
  void didUpdateWidget(QuotedMarkdown old) {
    super.didUpdateWidget(old);
    if (old.data != widget.data) {
      _document = MarkdownSelectionDocument(widget.data);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.draft.bindSource(widget.data);
      });
    }
    if (old.draft != widget.draft) {
      old.draft.removeListener(_refresh);
      widget.draft.addListener(_refresh);
    }
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.draft.removeListener(_refresh);
    super.dispose();
  }

  List<_ParagraphRange> _paragraphs() {
    final result = <_ParagraphRange>[];
    var cursor = 0;
    var contentCursor = 0;
    void walk(RenderObject object) {
      if (object is RenderParagraph && object.registrar != null) {
        final text = object.text.toPlainText();
        if (text.isNotEmpty) {
          final start = _document.plainText.indexOf(text, cursor);
          if (start >= 0) {
            result.add(_ParagraphRange(object, start, contentCursor));
            cursor = start + text.length;
          }
          contentCursor += text.length;
        }
      }
      object.visitChildren(walk);
    }

    final root = _contentKey.currentContext?.findRenderObject();
    if (root != null) walk(root);
    return result;
  }

  (int, int)? _selection() {
    if (!_selectionNotifier.registered) return null;
    final range = _selectionNotifier.selection.range;
    if (range == null || range.startOffset == range.endOffset) return null;
    final a = math.min(range.startOffset, range.endOffset);
    final b = math.max(range.startOffset, range.endOffset);
    int? start;
    int? end;
    for (final part in _paragraphs()) {
      final length = part.paragraph.text.toPlainText().length;
      final localStart = math.max(0, a - part.contentStart);
      final localEnd = math.min(length, b - part.contentStart);
      if (localStart < localEnd) {
        start ??= part.start + localStart;
        end = part.start + localEnd;
      }
    }
    return start == null || end == null ? null : (start, end);
  }

  Future<void> _comment(
    SelectableRegionState region,
    int start,
    int end,
    String markdown,
  ) async {
    region.hideToolbar();
    final instruction = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _SelectionComment(markdown: markdown),
    );
    if (!mounted) return;
    if (instruction != null && instruction.trim().isNotEmpty) {
      widget.draft.add(start, end, markdown, instruction);
      region.clearSelection();
    }
  }

  @override
  Widget build(BuildContext context) => SelectionArea(
    contextMenuBuilder: (context, region) {
      final range = _selection();
      if (range == null) return const SizedBox.shrink();
      final (start, end) = range;
      final markdown = _document.slice(start, end);
      return AdaptiveTextSelectionToolbar.buttonItems(
        anchors: region.contextMenuAnchors,
        buttonItems: [
          ContextMenuButtonItem(
            label: '复制',
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: markdown));
              region.hideToolbar();
            },
          ),
          ContextMenuButtonItem(
            label: 'AI+',
            onPressed: () => _comment(region, start, end, markdown),
          ),
        ],
      );
    },
    child: SelectionListener(
      selectionNotifier: _selectionNotifier,
      child: CustomPaint(
        foregroundPainter: _QuotePainter(
          _paragraphs,
          widget.draft.quotes,
          _contentKey,
        ),
        child: SizedBox(
          key: _contentKey,
          width: double.infinity,
          child: IMindMarkdown(
            data: widget.data,
            api: widget.api,
            machine: widget.machine,
            noteId: widget.noteId,
          ),
        ),
      ),
    ),
  );
}

class _SelectionComment extends StatefulWidget {
  const _SelectionComment({required this.markdown});
  final String markdown;
  @override
  State<_SelectionComment> createState() => _SelectionCommentState();
}

class _SelectionCommentState extends State<_SelectionComment> {
  final _input = TextEditingController();
  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _submit() {
    if (_input.text.trim().isNotEmpty) {
      Navigator.pop(context, _input.text.trim());
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text(
                  'AI+ 划词评论',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                IconButton(
                  tooltip: '取消划词评论',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: const Color(0xFFF2F2F6),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                widget.markdown,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Color(0xFF6C6C70)),
              ),
            ),
            AiComposer(
              controller: _input,
              autofocus: true,
              onSend: _submit,
              onTapOutside: () => Navigator.pop(context),
            ),
          ],
        ),
      ),
    ),
  );
}

class _QuotePainter extends CustomPainter {
  _QuotePainter(this.paragraphs, this.quotes, this.contentKey);
  final List<_ParagraphRange> Function() paragraphs;
  final List<NoteQuote> quotes;
  final GlobalKey contentKey;
  @override
  void paint(Canvas canvas, Size size) {
    final root = contentKey.currentContext?.findRenderObject();
    if (root is! RenderBox) return;
    final parts = paragraphs();
    for (final quote in quotes) {
      Rect? last;
      for (final part in parts) {
        final length = part.paragraph.text.toPlainText().length;
        final a = math.max(quote.start - part.start, 0);
        final b = math.min(quote.end - part.start, length);
        if (a >= b) continue;
        final origin = part.paragraph.localToGlobal(
          Offset.zero,
          ancestor: root,
        );
        for (final box in part.paragraph.getBoxesForSelection(
          TextSelection(baseOffset: a, extentOffset: b),
        )) {
          final rect = box.toRect().shift(origin);
          canvas.drawRRect(
            RRect.fromRectAndRadius(rect, const Radius.circular(3)),
            Paint()..color = const Color(0x443478F6),
          );
          last = rect;
        }
      }
      if (last != null) {
        final label = TextPainter(
          text: TextSpan(
            text: '${quote.number}',
            style: const TextStyle(
              fontSize: 10,
              color: Colors.white,
              fontWeight: FontWeight.w600,
            ),
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        final width = math.max(18.0, label.width + 8);
        final rect = Rect.fromLTWH(
          math.min(last.right, math.max(0, size.width - width)),
          math.max(0, last.top - 9),
          width,
          16,
        );
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, const Radius.circular(8)),
          Paint()..color = const Color(0xFF3478F6),
        );
        label.paint(
          canvas,
          Offset(
            rect.center.dx - label.width / 2,
            rect.center.dy - label.height / 2,
          ),
        );
      }
    }
  }

  @override
  bool shouldRepaint(_QuotePainter oldDelegate) => true;
}
