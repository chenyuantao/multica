import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import 'api.dart';

class MediaService {
  const MediaService(this.api);
  final MulticaApi api;

  Future<void> upload({
    required String machine,
    required String noteId,
    required String name,
    required String contentType,
    required Uint8List bytes,
  }) => api.uploadMedia(
    machine: machine,
    noteId: noteId,
    name: name,
    contentType: contentType,
    bytes: bytes,
  );

  Future<Uint8List> read({
    required String machine,
    required String noteId,
    required String name,
  }) async => Uint8List.fromList(
    await api.getMedia(machine: machine, noteId: noteId, name: name),
  );

  Future<PickedImage?> pickImage(
    ImageSource source, {
    ImagePicker? picker,
  }) async {
    final selected = await (picker ?? ImagePicker()).pickImage(
      source: source,
      imageQuality: 95,
      requestFullMetadata: false,
    );
    if (selected == null) return null;
    final path = selected.path.toLowerCase();
    final mime =
        selected.mimeType ??
        switch (path.split('.').last) {
          'jpg' || 'jpeg' => 'image/jpeg',
          'png' => 'image/png',
          'webp' => 'image/webp',
          _ => '',
        };
    final extension = switch (mime) {
      'image/jpeg' => '.jpg',
      'image/png' => '.png',
      'image/webp' => '.webp',
      _ => throw const FormatException('只支持 JPG、PNG 和 WebP 图片'),
    };
    final bytes = await selected.readAsBytes();
    if (bytes.isEmpty) throw const FormatException('图片为空，未插入');
    return PickedImage(
      name: '${const Uuid().v4()}$extension',
      contentType: mime,
      bytes: bytes,
    );
  }
}

class PickedImage {
  const PickedImage({
    required this.name,
    required this.contentType,
    required this.bytes,
  });
  final String name;
  final String contentType;
  final Uint8List bytes;
}

void insertMarkdownImage(
  TextEditingController controller,
  String noteId,
  String name,
) {
  _insertMarkdown(controller, '![图片](media/$noteId/$name)');
}

void insertPendingMarkdownImage(TextEditingController controller, String name) {
  _insertMarkdown(controller, '![图片](pending:$name)');
}

void _insertMarkdown(TextEditingController controller, String markdown) {
  final text = controller.text;
  final selection = controller.selection.isValid
      ? controller.selection
      : TextSelection.collapsed(offset: text.length);
  final start = selection.start.clamp(0, text.length);
  final end = selection.end.clamp(start, text.length);
  final before = text.substring(0, start);
  final after = text.substring(end);
  final prefix = before.isNotEmpty && !before.endsWith('\n') ? '\n' : '';
  final insertion = '$markdown\n';
  controller.value = TextEditingValue(
    text: '$before$prefix$insertion$after',
    selection: TextSelection.collapsed(
      offset: before.length + prefix.length + insertion.length,
    ),
  );
}

Uint8List pcm16MonoWav(List<int> pcm, {int sampleRate = 16000}) {
  final out = ByteData(44 + pcm.length);
  void text(int offset, String value) {
    for (var i = 0; i < value.length; i++) {
      out.setUint8(offset + i, value.codeUnitAt(i));
    }
  }

  text(0, 'RIFF');
  out.setUint32(4, 36 + pcm.length, Endian.little);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, Endian.little);
  out.setUint16(20, 1, Endian.little);
  out.setUint16(22, 1, Endian.little);
  out.setUint32(24, sampleRate, Endian.little);
  out.setUint32(28, sampleRate * 2, Endian.little);
  out.setUint16(32, 2, Endian.little);
  out.setUint16(34, 16, Endian.little);
  text(36, 'data');
  out.setUint32(40, pcm.length, Endian.little);
  for (var i = 0; i < pcm.length; i++) {
    out.setUint8(44 + i, pcm[i]);
  }
  return out.buffer.asUint8List();
}

String? imindMediaName(String markdownUrl, String noteId) {
  final match = RegExp(
    r'^media/([0-9a-f-]{36})/([A-Za-z0-9-]+\.(?:jpe?g|png|webp))$',
    caseSensitive: false,
  ).firstMatch(markdownUrl);
  if (match == null || match.group(1)!.toLowerCase() != noteId.toLowerCase()) {
    return null;
  }
  return match.group(2);
}

/// Resolves shared relative media without exposing credentials in image URLs.
class IMindMarkdown extends StatelessWidget {
  const IMindMarkdown({
    super.key,
    required this.data,
    this.api,
    this.machine,
    this.noteId,
    this.pendingImages = const {},
  });
  final String data;
  final MulticaApi? api;
  final String? machine;
  final String? noteId;
  final Map<String, Uint8List> pendingImages;

  @override
  Widget build(BuildContext context) => MarkdownBody(
    data: data,
    sizedImageBuilder: (config) {
      final uri = config.uri;
      final pending = pendingImages[uri.path];
      if (uri.scheme == 'pending' && pending != null) {
        return Image.memory(pending, fit: BoxFit.contain);
      }
      final name = noteId == null
          ? null
          : imindMediaName(uri.toString(), noteId!);
      if (name != null && api != null && machine != null) {
        return _SharedImage(
          key: ValueKey('$machine/$noteId/$name'),
          api: api!,
          machine: machine!,
          noteId: noteId!,
          name: name,
        );
      }
      if (uri.scheme == 'https' || uri.scheme == 'http') {
        return Image.network(
          uri.toString(),
          fit: BoxFit.contain,
          errorBuilder: (_, _, _) => const Text('图片无法读取'),
        );
      }
      return const Text('图片引用无效或尚未保存');
    },
  );
}

class _SharedImage extends StatefulWidget {
  const _SharedImage({
    super.key,
    required this.api,
    required this.machine,
    required this.noteId,
    required this.name,
  });
  final MulticaApi api;
  final String machine;
  final String noteId;
  final String name;
  @override
  State<_SharedImage> createState() => _SharedImageState();
}

class _SharedImageState extends State<_SharedImage> {
  late Future<List<int>> _bytes = _read();
  Future<List<int>> _read() => widget.api.getMedia(
    machine: widget.machine,
    noteId: widget.noteId,
    name: widget.name,
  );
  @override
  Widget build(BuildContext context) => FutureBuilder<List<int>>(
    future: _bytes,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return TextButton.icon(
          onPressed: () => setState(() => _bytes = _read()),
          icon: const Icon(Icons.refresh),
          label: const Text('图片读取失败，重试'),
        );
      }
      if (!snapshot.hasData) {
        return const SizedBox(
          height: 40,
          child: Center(child: CircularProgressIndicator()),
        );
      }
      return Image.memory(
        Uint8List.fromList(snapshot.data!),
        fit: BoxFit.contain,
        errorBuilder: (_, _, _) => const Text('图片内容无法显示'),
      );
    },
  );
}
