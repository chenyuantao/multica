import 'package:flutter/material.dart';

import 'chat_time.dart';
import 'home_chrome.dart';

class NoteListPreview extends StatelessWidget {
  const NoteListPreview({super.key, required this.note, this.unreadBadge});

  final Map<String, dynamic> note;
  final Widget? unreadBadge;

  @override
  Widget build(BuildContext context) {
    final title = _text(note['title']);
    final category = noteTypeLabel(_text(note['type']));
    final rawTags = note['tags'];
    final tags = rawTags is List
        ? rawTags
              .map(_text)
              .where((tag) => tag.isNotEmpty)
              .map((tag) => '#$tag')
              .join(' ')
        : '';
    final author = _text(note['author']);
    final time = chatTimeLabel(note['updated_at']);

    return Row(
      children: [
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 15.5, height: 1.4),
              ),
              const SizedBox(height: 7),
              Row(
                children: [
                  Text(
                    category,
                    maxLines: 1,
                    style: const TextStyle(fontSize: 12, color: homeSecondary),
                  ),
                  if (tags.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Flexible(
                      flex: 2,
                      child: Text(
                        tags,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: homeSecondary,
                        ),
                      ),
                    ),
                  ],
                  if (author.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        author,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: homeSecondary,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
        if (time.isNotEmpty || unreadBadge != null) ...[
          const SizedBox(width: 8),
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (time.isNotEmpty)
                Text(
                  time,
                  maxLines: 1,
                  softWrap: false,
                  style: const TextStyle(fontSize: 12, color: homeSecondary),
                ),
              if (unreadBadge != null) ...[
                const SizedBox(height: 5),
                unreadBadge!,
              ],
            ],
          ),
        ],
      ],
    );
  }
}

String _text(Object? value) =>
    value is String ? value.replaceAll(RegExp(r'\s+'), ' ').trim() : '';

String noteTypeLabel(String? type) => switch (type) {
  'recording' => '音频',
  'clip' => '剪藏',
  'note' => '笔记',
  _ => type ?? '',
};
