import 'package:flutter/material.dart';

import 'api.dart';

List<String> normalizedTags(Iterable<String> tags) => {
  for (final tag in tags)
    if (tag.trim().isNotEmpty) tag.trim(),
}.toList();

List<String> tagsOf(Map<String, dynamic> note) =>
    normalizedTags(((note['tags'] as List?) ?? []).cast<String>());

/// Prepares revision-checked writes once so retries never reapply a rename.
class TagWrites {
  TagWrites(this.api, this.machine);
  final MulticaApi api;
  final String machine;
  List<Map<String, dynamic>>? _pending;

  Future<void> save(
    List<Map<String, dynamic>> notes,
    List<String> Function(List<String>) transform,
  ) async {
    if (_pending == null) {
      final pending = <Map<String, dynamic>>[];
      for (final item in notes) {
        final before = tagsOf(item);
        final after = normalizedTags(transform(before));
        if (before.length == after.length &&
            before.toSet().containsAll(after)) {
          continue;
        }
        final note = await api.getNote(machine, '${item['id']}');
        // Preserve concurrent content edits, but reject concurrent tag changes.
        final current = tagsOf(note);
        if (current.length != before.length ||
            !current.toSet().containsAll(before)) {
          throw StateError('标签已被修改，请返回后重新打开');
        }
        pending.add({...note, 'tags': after});
      }
      _pending = pending;
    }
    while (_pending!.isNotEmpty) {
      final note = _pending!.first;
      await api.updateNote('${note['id']}', {
        'share_machine': machine,
        'revision': note['revision'],
        'title': note['title'],
        'tags': note['tags'],
        'content': note['content'] ?? '',
        'transcript': note['transcript'] ?? '',
        'audio': note['audio'],
      });
      _pending!.removeAt(0);
    }
  }
}

Future<bool?> assignNoteTags(
  BuildContext context, {
  required MulticaApi api,
  required String machine,
  required List<String> noteIds,
}) => Navigator.of(context).push<bool>(
  MaterialPageRoute(
    builder: (_) => _TagPage(api: api, machine: machine, noteIds: noteIds),
  ),
);

Future<Map<String, String?>?> manageNoteTags(
  BuildContext context, {
  required MulticaApi api,
  required String machine,
}) => Navigator.of(context).push<Map<String, String?>>(
  MaterialPageRoute(
    builder: (_) => _TagPage(api: api, machine: machine),
  ),
);

class _TagPage extends StatefulWidget {
  const _TagPage({required this.api, required this.machine, this.noteIds});
  final MulticaApi api;
  final String machine;
  final List<String>? noteIds;

  @override
  State<_TagPage> createState() => _TagPageState();
}

class _TagPageState extends State<_TagPage> {
  final _input = TextEditingController();
  final _names = <String, String?>{};
  final _selection = <String, bool?>{};
  List<Map<String, dynamic>>? _notes;
  late TagWrites _writes;
  String? _selected;
  String? _error;
  bool _saving = false;
  bool _locked = false;
  bool get _managing => widget.noteIds == null;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final notes = await widget.api.notes(widget.machine);
      if (!mounted) return;
      final chosen = notes
          .where((n) => widget.noteIds?.contains(n['id']) ?? false)
          .toList();
      if (!_managing && chosen.length != widget.noteIds!.toSet().length) {
        throw StateError('笔记已被删除，请返回后刷新');
      }
      setState(() {
        _notes = notes;
        _writes = TagWrites(widget.api, widget.machine);
        _names.clear();
        _selection.clear();
        final tags = normalizedTags(notes.expand(tagsOf))..sort();
        for (final tag in tags) {
          _names[tag] = tag;
          final count = chosen.where((n) => tagsOf(n).contains(tag)).length;
          _selection[tag] = count == 0
              ? false
              : count == chosen.length
              ? true
              : null;
        }
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _add() {
    final tag = _input.text.trim();
    if (tag.isEmpty) return;
    setState(() {
      _selection[tag] = true;
      _input.clear();
    });
  }

  bool _rename() {
    final tag = _input.text.trim();
    if (_selected == null) return true;
    if (tag.isEmpty) {
      setState(() => _error = '标签名称不能为空');
      return false;
    }
    if (_names.entries.any((e) => e.key != _selected && e.value == tag)) {
      setState(() => _error = '标签已存在');
      return false;
    }
    setState(() {
      _names[_selected!] = tag;
      _error = null;
      _input.clear();
      _selected = null;
    });
    return true;
  }

  Future<void> _manage() async {
    final draft = Map<String, bool?>.of(_selection);
    final changes = await manageNoteTags(
      context,
      api: widget.api,
      machine: widget.machine,
    );
    if (!mounted) return;
    await _load();
    if (!mounted) return;
    setState(() {
      for (final entry in draft.entries) {
        final name = changes != null && changes.containsKey(entry.key)
            ? changes[entry.key]
            : entry.key;
        if (name != null) _selection[name] = entry.value;
      }
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    if (!_locked) {
      if (_managing && !_rename()) return;
      if (!_managing) _add();
    }
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _saving = true;
      _locked = true;
      _error = null;
    });
    try {
      final notes = _managing
          ? await widget.api.notes(widget.machine)
          : _notes!.where((n) => widget.noteIds!.contains(n['id'])).toList();
      await _writes.save(notes, (tags) {
        if (_managing) {
          return [
            for (final tag in tags)
              if ((_names.containsKey(tag) ? _names[tag] : tag)
                  case final String name)
                name,
          ];
        }
        return [
          for (final tag in tags)
            if (_selection[tag] != false) tag,
          for (final entry in _selection.entries)
            if (entry.value == true) entry.key,
        ];
      });
      if (mounted) {
        Navigator.pop(
          context,
          _managing ? Map<String, String?>.of(_names) : true,
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = '无法完成保存：$error。部分笔记可能已更新，可重试保存。');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving,
    child: Scaffold(
      appBar: AppBar(
        title: Text(_managing ? '标签管理' : '标记'),
        actions: [
          TextButton(
            onPressed: _notes == null || _saving ? null : _save,
            child: Text(_saving ? '保存中' : '保存'),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (_notes == null) ...[
            if (_error == null)
              const LinearProgressIndicator()
            else
              TextButton(onPressed: _load, child: const Text('重试')),
          ] else ...[
            if (!_managing)
              ListTile(
                title: const Text('编辑标签'),
                trailing: const Icon(Icons.chevron_right),
                onTap: _locked ? null : _manage,
              ),
            if (!_managing || _selected != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _input,
                        enabled: !_locked,
                        decoration: InputDecoration(
                          labelText: _managing ? '标签名称' : '新建标签',
                        ),
                        onSubmitted: (_) => _managing ? _rename() : _add(),
                      ),
                    ),
                    TextButton(
                      onPressed: _locked
                          ? null
                          : _managing
                          ? _rename
                          : _add,
                      child: Text(_managing ? '修改' : '添加'),
                    ),
                    if (_managing)
                      IconButton(
                        tooltip: '删除标签',
                        onPressed: _locked
                            ? null
                            : () => setState(() {
                                _names[_selected!] = null;
                                _selected = null;
                                _input.clear();
                              }),
                        icon: const Icon(Icons.delete_outline),
                      ),
                  ],
                ),
              ),
            if (_managing)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('修改或删除标签会同步更新所有使用该标签的笔记。'),
              ),
            Expanded(
              child: ListView(
                children: [
                  if (_managing && _names.values.every((name) => name == null))
                    const ListTile(title: Text('暂无标签')),
                  if (_managing) ...[
                    for (final entry in _names.entries)
                      if (entry.value != null)
                        ListTile(
                          title: Text(entry.value!),
                          selected: _selected == entry.key,
                          trailing: _selected == entry.key
                              ? const Icon(Icons.check)
                              : null,
                          onTap: _locked
                              ? null
                              : () => setState(() {
                                  _selected = entry.key;
                                  _input.text = entry.value!;
                                }),
                        ),
                  ] else ...[
                    for (final entry in _selection.entries)
                      CheckboxListTile(
                        title: Text(entry.key),
                        tristate: true,
                        value: entry.value,
                        onChanged: _locked
                            ? null
                            : (_) => setState(
                                () =>
                                    _selection[entry.key] = entry.value != true,
                              ),
                      ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    ),
  );
}
