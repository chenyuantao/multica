import 'package:flutter/material.dart';

Future<String?> pickNoteTag(
  BuildContext context, {
  required List<String> tags,
}) async {
  final controller = TextEditingController();
  final result = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('标记'),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: SingleChildScrollView(
                child: Wrap(
                  spacing: 8,
                  children: [
                    for (final tag in tags)
                      ActionChip(
                        label: Text(tag),
                        onPressed: () => Navigator.pop(context, tag),
                      ),
                  ],
                ),
              ),
            ),
            TextField(
              controller: controller,
              decoration: const InputDecoration(hintText: '新建标签'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, controller.text.trim()),
          child: const Text('添加'),
        ),
      ],
    ),
  );
  Future<void>.delayed(const Duration(milliseconds: 350), controller.dispose);
  return result == null || result.trim().isEmpty ? null : result.trim();
}
