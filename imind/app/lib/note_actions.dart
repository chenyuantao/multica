import 'dart:convert';

import 'package:flutter/material.dart';

class DetailTitle extends StatelessWidget {
  const DetailTitle(this.title, {super.key});
  final String title;

  @override
  Widget build(BuildContext context) => Text(
    title,
    key: const ValueKey('detail-title'),
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
  );
}

class NoteActions extends StatelessWidget {
  const NoteActions({
    super.key,
    required this.note,
    required this.onRename,
    required this.onDelete,
  });
  final Map<String, dynamic> note;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
    tooltip: '更多',
    icon: const Icon(Icons.more_horiz),
    onSelected: (action) {
      switch (action) {
        case 'info':
          showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            useSafeArea: true,
            builder: (context) => FractionallySizedBox(
              heightFactor: .75,
              child: Column(
                children: [
                  ListTile(
                    title: const Text('文件信息'),
                    trailing: IconButton(
                      tooltip: '关闭信息',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(20),
                      children: [
                        _field(
                          '字数',
                          '${'${note['content'] ?? ''}'.trim().length}',
                        ),
                        if ('${note['transcript'] ?? ''}'.isNotEmpty)
                          _field(
                            '原文字数',
                            '${'${note['transcript']}'.trim().length}',
                          ),
                        for (final entry in note.entries)
                          if (!{
                            'content',
                            'transcript',
                            'title',
                          }.contains(entry.key))
                            _field(
                              _labels[entry.key] ?? entry.key,
                              entry.value,
                            ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        case 'rename':
          onRename();
        case 'delete':
          onDelete();
      }
    },
    itemBuilder: (_) => const [
      PopupMenuItem(value: 'info', child: Text('Info · 文件信息')),
      PopupMenuItem(value: 'rename', child: Text('重命名')),
      PopupMenuItem(enabled: false, child: Text('导出 · 暂不可用')),
      PopupMenuItem(
        value: 'delete',
        child: Text('删除', style: TextStyle(color: Colors.red)),
      ),
    ],
  );

  static const _labels = {
    'id': 'ID',
    'type': '类型',
    'tags': '标签',
    'source_url': '链接 URL',
    'created_at': '创建时间',
    'updated_at': '更新时间',
    'summary': '摘要',
    'audio': '音频',
    'clip': '剪藏',
    'path': '文件路径',
    'revision': '版本',
    'duration_ms': '时长（毫秒）',
  };

  Widget _field(String label, dynamic value) => Padding(
    padding: const EdgeInsets.only(bottom: 18),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        const SizedBox(height: 4),
        SelectableText(
          value == null
              ? '—'
              : value is String
              ? value
              : const JsonEncoder.withIndent('  ').convert(value),
        ),
      ],
    ),
  );
}
