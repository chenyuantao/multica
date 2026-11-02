import 'dart:math' as math;
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import 'selection_comment.dart';
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
  PointerDownEvent? _pointerDown;
  Timer? _tapTimer;
  final _contentKey = GlobalKey();
  final _areaKey = GlobalKey<SelectionAreaState>();
  final _selectionNotifier = SelectionListenerNotifier();
  late MarkdownSelectionDocument _document;
  @override
  void initState() {
    super.initState();
    _document = MarkdownSelectionDocument(widget.data);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.draft.bindSource(widget.data);
    });
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
    if (widget.draft.deleting) {
      _areaKey.currentState?.selectableRegion.clearSelection();
      FocusManager.instance.primaryFocus?.unfocus();
    }
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _tapTimer?.cancel();
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
      builder: (_) => SelectionCommentSheet(
        markdown: markdown,
        api: widget.api,
        machine: widget.machine,
      ),
    );
    if (!mounted) return;
    if (instruction != null && instruction.trim().isNotEmpty) {
      widget.draft.add(start, end, markdown, instruction);
      region.clearSelection();
    }
  }

  List<_QuoteGeometry> _geometry(Size size) {
    final root = _contentKey.currentContext?.findRenderObject();
    if (root is! RenderBox) return [];
    final parts = _paragraphs();
    return [
      for (final quote in widget.draft.quotes)
        _QuoteGeometry.fromParagraphs(quote, parts, root, size),
    ];
  }

  void _tapMark(Offset globalPosition) {
    final root = _contentKey.currentContext?.findRenderObject();
    if (root is! RenderBox) return;
    final point = root.globalToLocal(globalPosition);
    for (final mark in _geometry(root.size).reversed) {
      if ((mark.badge?.inflate(4).contains(point) ?? false) ||
          mark.rects.any((rect) => rect.contains(point))) {
        widget.draft.toggleSelected(mark.quote);
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) => Listener(
    behavior: HitTestBehavior.opaque,
    onPointerDown: (event) {
      _pointerDown = event;
      _tapTimer?.cancel();
      _tapTimer = Timer(kLongPressTimeout, () => _pointerDown = null);
    },
    onPointerMove: (event) {
      if (_pointerDown != null &&
          (event.position - _pointerDown!.position).distance > kTouchSlop) {
        _pointerDown = null;
      }
    },
    onPointerCancel: (_) {
      _tapTimer?.cancel();
      _pointerDown = null;
    },
    onPointerUp: (event) {
      final down = _pointerDown;
      _pointerDown = null;
      if (down != null &&
          event.timeStamp - down.timeStamp < kLongPressTimeout) {
        _tapMark(event.position);
      }
    },
    child: CustomPaint(
      foregroundPainter: _QuotePainter(
        _geometry,
        widget.draft.selected,
        onTap: widget.draft.toggleSelected,
      ),
      child: IgnorePointer(
        ignoring: widget.draft.deleting,
        child: SelectionArea(
          key: _areaKey,
          contextMenuBuilder: (context, region) {
            if (widget.draft.deleting) return const SizedBox.shrink();
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
      ),
    ),
  );
}

class _QuoteGeometry {
  _QuoteGeometry(this.quote, this.rects, this.badge);
  final NoteQuote quote;
  final List<Rect> rects;
  final Rect? badge;

  factory _QuoteGeometry.fromParagraphs(
    NoteQuote quote,
    List<_ParagraphRange> parts,
    RenderBox root,
    Size size,
  ) {
    final rects = <Rect>[];
    for (final part in parts) {
      final length = part.paragraph.text.toPlainText().length;
      final a = math.max(quote.start - part.start, 0);
      final b = math.min(quote.end - part.start, length);
      if (a >= b) continue;
      final origin = part.paragraph.localToGlobal(Offset.zero, ancestor: root);
      for (final box in part.paragraph.getBoxesForSelection(
        TextSelection(baseOffset: a, extentOffset: b),
      )) {
        rects.add(box.toRect().shift(origin));
      }
    }
    final last = rects.lastOrNull;
    final width = math.max(18.0, _quoteLabel(quote.number).width + 8);
    final badge = last == null
        ? null
        : Rect.fromLTWH(
            math.min(last.right, math.max(0, size.width - width)),
            math.max(0, last.top - 9),
            width,
            16,
          );
    return _QuoteGeometry(quote, rects, badge);
  }
}

TextPainter _quoteLabel(int number) => TextPainter(
  text: TextSpan(
    text: '$number',
    style: const TextStyle(
      fontSize: 10,
      color: Colors.white,
      fontWeight: FontWeight.w600,
    ),
  ),
  textDirection: TextDirection.ltr,
)..layout();

class _QuotePainter extends CustomPainter {
  _QuotePainter(this.geometry, this.selected, {required this.onTap});
  final List<_QuoteGeometry> Function(Size) geometry;
  final Set<int> selected;
  final ValueChanged<NoteQuote> onTap;
  @override
  void paint(Canvas canvas, Size size) {
    for (final mark in geometry(size)) {
      final active = selected.contains(mark.quote.number);
      for (final rect in mark.rects) {
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, const Radius.circular(3)),
          Paint()
            ..color = active
                ? const Color(0x66FF9F0A)
                : const Color(0x443478F6),
        );
      }
      final badge = mark.badge;
      if (badge == null) continue;
      canvas.drawRRect(
        RRect.fromRectAndRadius(badge, const Radius.circular(8)),
        Paint()
          ..color = active ? const Color(0xFFB85C00) : const Color(0xFF3478F6),
      );
      final label = _quoteLabel(mark.quote.number);
      label.paint(
        canvas,
        Offset(
          badge.center.dx - label.width / 2,
          badge.center.dy - label.height / 2,
        ),
      );
    }
  }

  @override
  SemanticsBuilderCallback get semanticsBuilder =>
      (size) => [
        for (final mark in geometry(size))
          if (mark.badge != null)
            CustomPainterSemantics(
              rect: mark.badge!.inflate(6),
              properties: SemanticsProperties(
                label: '标记 ${mark.quote.number}',
                button: true,
                selected: selected.contains(mark.quote.number),
                textDirection: TextDirection.ltr,
                onTap: () => onTap(mark.quote),
              ),
            ),
      ];
  @override
  bool shouldRebuildSemantics(_QuotePainter oldDelegate) => true;
  @override
  bool shouldRepaint(_QuotePainter oldDelegate) => true;
}
