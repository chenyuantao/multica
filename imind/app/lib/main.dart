import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:image_picker/image_picker.dart';

import 'asr_session.dart';

import 'ai_chat.dart';
import 'chat_unread.dart';
import 'api.dart';
import 'session.dart';
import 'transcript.dart';
import 'media.dart';
import 'url_extract.dart';
import 'input_insets.dart';
import 'note_actions.dart';
import 'tag_picker.dart';
import 'voice_input.dart';

const _bg = Color(0xFFF2F2F6);
const _ink = Color(0xFF1C1C1E);
const _sub = Color(0xFF8E8E93);
const _blue = Color(0xFF3478F6);
const _dark = Color(0xFF23262C);
const _line = Color(0xFFE2E2E7);
const _red = Color(0xFFE5484D);

void main() => runApp(const IMindApp());

class IMindApp extends StatelessWidget {
  const IMindApp({super.key, this.initialToken, this.api, this.sessionStore});

  final String? initialToken;
  final MulticaApi? api;
  final SessionStore? sessionStore;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'iMind',
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: _bg,
        colorScheme: ColorScheme.fromSeed(seedColor: _dark),
      ),
      home: SessionGate(
        initialToken: initialToken,
        api: api,
        sessionStore: sessionStore,
      ),
    );
  }
}

class SessionGate extends StatefulWidget {
  const SessionGate({
    super.key,
    this.initialToken,
    this.api,
    this.sessionStore,
  });
  final String? initialToken;
  final MulticaApi? api;
  final SessionStore? sessionStore;

  @override
  State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> with WidgetsBindingObserver {
  final _navigator = GlobalKey<NavigatorState>();
  late final _api = widget.api ?? MulticaApi(baseUrl: defaultApiBase());
  late final _session = SessionController(
    api: _api,
    store: widget.sessionStore,
  );
  late final _chatUnread = ChatUnreadController(_api);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _session.addListener(_refreshSession);
    _session.restore(initialToken: widget.initialToken);
  }

  void _refreshSession() {
    _chatUnread.configure(_session.data);
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_chatUnread.refresh());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _chatUnread.dispose();
    _session.removeListener(_refreshSession);
    _session.dispose();
    if (widget.api == null) _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_session.ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_session.data == null) {
      return LoginPage(
        api: _api,
        onLogin: _session.login,
        sessionError: _session.error,
      );
    }
    return ChatUnreadScope(
      controller: _chatUnread,
      child: NavigatorPopHandler<Object?>(
        onPopWithResult: (result) => _navigator.currentState?.maybePop(result),
        child: Navigator(
          key: _navigator,
          onGenerateRoute: (_) => MaterialPageRoute<void>(
            builder: (_) => HomePage(session: _session),
          ),
        ),
      ),
    );
  }
}

class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    required this.api,
    required this.onLogin,
    this.sessionError,
  });
  final MulticaApi api;
  final Future<void> Function(String token) onLogin;
  final String? sessionError;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  MulticaApi get _api => widget.api;
  var _sent = false;
  var _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!_sent) {
        await _api.sendCode(_email.text.trim());
        if (mounted) setState(() => _sent = true);
      } else {
        final token = await _api.verifyCode(
          _email.text.trim(),
          _code.text.trim(),
        );
        await widget.onLogin(token);
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(),
              const Text(
                'iMind',
                style: TextStyle(fontSize: 38, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 10),
              const Text('在这里，记录你的一切。', style: TextStyle(fontSize: 21)),
              const SizedBox(height: 28),
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(labelText: '邮箱'),
              ),
              if (_sent)
                TextField(
                  controller: _code,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '验证码'),
                ),
              if (_error != null || widget.sessionError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    _error ?? widget.sessionError!,
                    style: const TextStyle(color: _red),
                  ),
                ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: Text(_sent ? '登录' : '发送验证码'),
              ),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.session});
  final SessionController session;

  @override
  State<HomePage> createState() => _HomePageState();
}

enum _HomeSort {
  createdDescending('创建时间 · 倒序', 'created_at', true),
  createdAscending('创建时间 · 正序', 'created_at', false),
  updatedDescending('更新时间 · 倒序', 'updated_at', true),
  updatedAscending('更新时间 · 正序', 'updated_at', false);

  const _HomeSort(this.label, this.field, this.descending);
  final String label;
  final String field;
  final bool descending;
}

class _HomePageState extends State<HomePage> {
  final _scaffold = GlobalKey<ScaffoldState>();
  MulticaApi get _api => widget.session.api;
  Future<void>? _reloadInProgress;
  var _naming = false;
  List<Map<String, dynamic>> _notes = const [];
  String? _machine;
  String? _error;
  String? _kind;
  final _tags = <String>{};
  var _ready = false;
  var _sort = _HomeSort.updatedDescending;
  var _searching = false;
  final _searchInput = TextEditingController();
  Timer? _searchTimer;
  var _query = '';
  var _selecting = false;
  var _menu = false;
  var _tagging = false;
  final _selected = <String>{};

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _searchInput.dispose();
    super.dispose();
  }

  void _searchChanged(String value) {
    _searchTimer?.cancel();
    final query = value.trim().toLowerCase();
    if (query.isEmpty) {
      setState(() => _query = '');
      return;
    }
    _searchTimer = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _query = query);
    });
  }

  void _closeSearch() {
    _searchTimer?.cancel();
    FocusScope.of(context).unfocus();
    _searchInput.clear();
    setState(() {
      _searching = false;
      _query = '';
    });
  }

  Future<void> _chooseSort() => showModalBottomSheet<void>(
    context: context,
    useSafeArea: true,
    builder: (sheetContext) => Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Padding(padding: EdgeInsets.all(16), child: Text('排序方式')),
        for (final sort in _HomeSort.values)
          ListTile(
            title: Text(sort.label),
            selected: _sort == sort,
            leading: Icon(
              _sort == sort
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
            ),
            onTap: () {
              setState(() => _sort = sort);
              Navigator.pop(sheetContext);
            },
          ),
      ],
    ),
  );

  Future<void> _reload() {
    if (_reloadInProgress != null) return _reloadInProgress!;
    if (widget.session.data == null) return Future.value();
    final future = _loadNotes();
    _reloadInProgress = future;
    return future.whenComplete(() => _reloadInProgress = null);
  }

  Future<void> _loadNotes() async {
    try {
      final workspaces = await _api.workspaces();
      if (!mounted) return;
      if (workspaces.isEmpty) {
        await widget.session.select(null, null);
        if (!mounted) return;
        setState(() {
          _ready = true;
          _machine = null;
          _notes = const [];
          _error = '当前账号没有可访问的工作区';
        });
        return;
      }
      final savedSession = widget.session.data;
      final workspaceIds = [
        for (final workspace in workspaces) workspace['id'] as String,
      ];
      final workspaceId = workspaceIds.contains(savedSession?.workspaceId)
          ? savedSession!.workspaceId!
          : workspaceIds.first;
      final savedMachine = savedSession?.workspaceId == workspaceId
          ? savedSession?.machine
          : null;
      if (savedSession?.workspaceId != workspaceId) {
        setState(() {
          _machine = null;
          _notes = const [];
          _selected.clear();
        });
      }
      await widget.session.select(workspaceId, savedMachine);
      if (!mounted) return;
      final shares = await _api.shares();
      if (shares.isEmpty) {
        await widget.session.select(workspaceId, null);
        if (!mounted) return;
        setState(() {
          _ready = true;
          _machine = null;
          _notes = const [];
          _error = '当前工作区还没有已连接的共享知识库';
        });
        return;
      }
      final names = [for (final share in shares) share['machine'] as String];
      final machine = names.contains(savedMachine)
          ? savedMachine!
          : names.first;
      await widget.session.select(workspaceId, machine);
      if (!mounted) return;
      await _api.bootstrap(machine);
      final notes = await _api.notes(machine);
      if (!mounted) return;
      setState(() {
        _machine = machine;
        _notes = notes;
        _error = null;
        _ready = true;
        _selected.removeWhere((id) => !notes.any((note) => note['id'] == id));
      });
    } on ApiException catch (error) {
      if (error.status == 401 || !mounted) return;
      setState(() {
        _ready = true;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _ready = true;
        _error = '无法加载笔记，请重试';
      });
    }
  }

  List<Map<String, dynamic>> get _visible {
    final items = _notes.where((note) {
      if (_kind != null && note['type'] != _kind) return false;
      if (_tags.isNotEmpty && !noteTags(note).any(_tags.contains)) return false;
      if (_query.isNotEmpty &&
          !'${note['title'] ?? ''}'.toLowerCase().contains(_query) &&
          !'${note['content'] ?? ''}'.toLowerCase().contains(_query)) {
        return false;
      }
      return true;
    }).toList();
    items.sort((a, b) {
      final first =
          DateTime.tryParse('${a[_sort.field] ?? ''}')
              ?.microsecondsSinceEpoch ??
          0;
      final second =
          DateTime.tryParse('${b[_sort.field] ?? ''}')
              ?.microsecondsSinceEpoch ??
          0;
      final order = first.compareTo(second);
      if (order == 0) return '${a['id']}'.compareTo('${b['id']}');
      return _sort.descending ? -order : order;
    });
    return items;
  }

  List<String> get _allTags {
    final tags = <String>{};
    for (final note in _notes) {
      tags.addAll(noteTags(note));
    }
    return tags.toList()..sort();
  }

  String get _heading {
    return switch (_kind) {
      'recording' => '音频',
      'note' => '笔记',
      'clip' => '剪藏',
      _ => 'iMind',
    };
  }

  Future<void> _open(Map<String, dynamic> note) async {
    final machine = _machine;
    if (machine == null) return;
    final page = note['type'] == 'recording'
        ? RecordingDetail(api: _api, machine: machine, note: note)
        : NoteEditor(api: _api, machine: machine, note: note);
    await Navigator.of(context)
        .push<bool>(MaterialPageRoute(builder: (_) => page));
    if (mounted) _reload();
  }

  Future<void> _openEditor() async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => NoteEditor(api: _api, machine: _machine),
      ),
    );
    if (mounted) _reload();
  }

  Future<void> _openRecord() async {
    final machine = _machine;
    if (machine == null) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RecordPage(api: _api, machine: machine),
      ),
    );
    if (saved == true) _reload();
  }

  Future<void> _clip() async {
    final controller = TextEditingController();
    final prompt = TextEditingController();
    var error = '';
    final clip = await showModalBottomSheet<Map<String, String>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheet) {
            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 8,
                bottom: 16 + inputBottomInset(context),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Center(
                    child: SizedBox(
                      width: 38,
                      height: 5,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: Color(0xFFD8D8DD),
                          borderRadius: BorderRadius.all(Radius.circular(3)),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Row(
                    children: [
                      Icon(Icons.link, size: 22),
                      SizedBox(width: 8),
                      Text(
                        '网页剪藏',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '智能体会在文件群聊中处理链接并回写笔记。',
                    style: TextStyle(color: _sub, height: 1.4),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: controller,
                    decoration: const InputDecoration(
                      hintText: '粘贴包含链接的文字',
                      prefixIcon: Icon(Icons.link),
                    ),
                  ),
                  TextField(
                    controller: prompt,
                    decoration: const InputDecoration(labelText: '提示词（可选）'),
                    minLines: 1,
                    maxLines: 3,
                  ),
                  if (error.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(error, style: const TextStyle(color: _red)),
                    ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: _dark,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      onPressed: () {
                        final found = firstUrl(controller.text);
                        if (found == null) {
                          setSheet(() => error = '没有识别到链接');
                          return;
                        }
                        Navigator.pop(context, {
                          'url': found,
                          'original': controller.text,
                          'prompt': prompt.text.trim(),
                        });
                      },
                      child: const Text('剪藏'),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
    Future<void>.delayed(const Duration(milliseconds: 350), controller.dispose);
    Future<void>.delayed(const Duration(milliseconds: 350), prompt.dispose);
    final machine = _machine;
    if (clip == null || machine == null) return;
    try {
      final note = await _api.createNote({
        'share_machine': machine,
        'type': 'clip',
        'title': '生成中的剪藏',
        'source_url': clip['url'],
        'content': '',
        'clip': {'original_text': clip['original'], 'prompt': clip['prompt']},
      });
      if (!mounted) return;
      await _reload();
      if (!mounted) return;
      await showNoteAiChat(
        context,
        api: _api,
        machine: machine,
        note: note,
        initialMessage:
            '请剪藏以下网页并将结果回写到本群对应的占位文件：\n${clip['url']}'
            '${clip['prompt']!.isEmpty ? '' : '\n要求：${clip['prompt']}'}',
      );
      await _reload();
    } on ApiException catch (error) {
      _actionError(error);
    }
  }

  List<Map<String, dynamic>> get _chosen =>
      _notes.where((note) => _selected.contains('${note['id']}')).toList();

  Future<void> _patchChosen(
    Map<String, dynamic> Function(Map<String, dynamic> note) patch,
  ) async {
    final machine = _machine;
    if (machine == null) return;
    try {
      for (final selected in _chosen) {
        final note = await _api.getNote(machine, '${selected['id']}');
        final next = patch(note);
        await _api.updateNote('${note['id']}', {
          'share_machine': machine,
          'revision': selected['revision'],
          'title': next['title'] ?? note['title'],
          'tags': next['tags'] ?? noteTags(note),
          'content': next['content'] ?? note['content'] ?? '',
          'transcript': next['transcript'] ?? note['transcript'] ?? '',
          'audio': note['audio'],
        });
      }
    } on ApiException catch (error) {
      _actionError(error);
      return;
    }
    if (mounted) {
      setState(() {
        _selecting = false;
        _selected.clear();
      });
    }
    await _reload();
  }

  Future<void> _tagChosen() async {
    final tag = await pickNoteTag(context, tags: _allTags);
    if (tag == null || tag.trim().isEmpty) return;
    final name = tag.trim();
    await _patchChosen((note) {
      final tags = noteTags(note);
      if (!tags.contains(name)) tags.add(name);
      return {'tags': tags};
    });
  }

  Future<void> _renameChosen() async {
    final chosen = _chosen;
    if (chosen.length != 1) return;
    final controller = TextEditingController(text: '${chosen.first['title']}');
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('重命名'),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('完成'),
          ),
        ],
      ),
    );
    Future<void>.delayed(const Duration(milliseconds: 350), controller.dispose);
    if (title == null || title.isEmpty) return;
    await _patchChosen((_) => {'title': title});
  }

  Future<void> _aiNameChosen() async {
    final machine = _machine;
    if (machine == null || _naming) return;
    setState(() => _naming = true);
    try {
      for (final note in _chosen) {
        await _api.nameNote(machine, '${note['id']}', '${note['revision']}');
      }
      if (mounted) {
        setState(() {
          _selecting = false;
          _selected.clear();
        });
      }
    } on ApiException catch (error) {
      _actionError(error);
    } finally {
      if (mounted) setState(() => _naming = false);
    }
    await _reload();
  }

  Future<void> _aiTagChosen() async {
    final machine = _machine;
    if (machine == null || _tagging) return;
    setState(() => _tagging = true);
    try {
      for (final note in _chosen) {
        await _api.tagNote(
          machine,
          '${note['id']}',
          revision: '${note['revision']}',
        );
      }
      if (mounted) {
        setState(() {
          _selecting = false;
          _selected.clear();
        });
      }
    } on ApiException catch (error) {
      _actionError(error);
    } finally {
      if (mounted) setState(() => _tagging = false);
    }
    await _reload();
  }

  Future<void> _deleteChosen() async {
    final machine = _machine;
    final chosen = _chosen;
    if (machine == null || chosen.isEmpty) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text('删除 ${chosen.length} 个文件？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除', style: TextStyle(color: _red)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      for (final note in chosen) {
        await _api.deleteNote('${note['id']}', machine, '${note['revision']}');
      }
    } on ApiException catch (error) {
      _actionError(error);
      return;
    }
    if (mounted) {
      setState(() {
        _selecting = false;
        _selected.clear();
      });
    }
    await _reload();
  }

  void _actionError(ApiException error) {
    if (!mounted || error.status == 401) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(error.message)));
  }

  void _showInfo() {
    final text = _chosen
        .map(
          (note) =>
              '${note['title']}\n${noteTypeLabel(note['type'] as String?)} · ${formatWhen(note['updated_at'] as String?)}',
        )
        .join('\n\n');
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('简介'),
        content: Text(text.isEmpty ? '没有选中文件' : text),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    final showHero =
        _ready &&
        _error == null &&
        _notes.isEmpty &&
        _kind == null &&
        _tags.isEmpty &&
        _query.isEmpty;
    return PopScope(
      canPop: !_searching,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _searching) _closeSearch();
      },
      child: Scaffold(
        key: _scaffold,
        backgroundColor: _bg,
        drawer: _drawer(),
        body: Stack(
          children: [
            SafeArea(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _header(),
                  if (_allTags.isNotEmpty) _tagFilters(),
                  if (_kind != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
                      child: Text(
                        _heading,
                        style: const TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.6,
                        ),
                      ),
                    ),
                  if (_tags.isNotEmpty || _kind != null || _query.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 0, 18, 6),
                      child: Text(
                        '${visible.length} 个文件',
                        style: const TextStyle(fontSize: 13, color: _sub),
                      ),
                    ),
                  Expanded(child: _body(showHero, visible)),
                ],
              ),
            ),
            if (!_selecting)
              Positioned(
                left: 0,
                right: 0,
                bottom: 28,
                child: Center(
                  child: ActionPill(
                    children: [
                      PillButton(
                        dark: true,
                        icon: Icons.mic_none,
                        label: '录音',
                        onPressed: _machine == null ? null : _openRecord,
                      ),
                      PillButton(
                        icon: Icons.link,
                        label: '剪藏',
                        onPressed: _machine == null ? null : _clip,
                      ),
                      PillButton(
                        icon: Icons.edit_outlined,
                        label: '笔记',
                        onPressed: _machine == null ? null : _openEditor,
                      ),
                    ],
                  ),
                ),
              ),
            if (_selecting)
              Positioned(left: 0, right: 0, bottom: 0, child: _selectBar()),
            if (_menu) _menuLayer(),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    if (_selecting) {
      return SizedBox(
        height: 54,
        child: Align(
          alignment: Alignment.centerRight,
          child: Padding(
            padding: const EdgeInsets.only(right: 12),
            child: _round(
              label: '完成',
              onTap: () => setState(() {
                _selecting = false;
                _selected.clear();
              }),
              child: const Text(
                '完成',
                style: TextStyle(
                  color: _blue,
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                ),
              ),
            ),
          ),
        ),
      );
    }
    if (_searching) {
      return SizedBox(
        height: 54,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              _round(
                label: '返回',
                onTap: _closeSearch,
                child: const Icon(Icons.arrow_back, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _searchInput,
                  autofocus: true,
                  textInputAction: TextInputAction.search,
                  decoration: const InputDecoration(
                    hintText: '搜索标题或内容',
                    border: InputBorder.none,
                  ),
                  onChanged: _searchChanged,
                ),
              ),
            ],
          ),
        ),
      );
    }
    return SizedBox(
      height: 54,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            _round(
              label: '菜单',
              onTap: () => _scaffold.currentState?.openDrawer(),
              child: const Icon(Icons.menu, size: 22),
            ),
            const SizedBox(width: 12),
            const DetailTitle('iMind'),
            const Spacer(),
            if (_tags.isNotEmpty)
              TextButton(
                onPressed: () => setState(_tags.clear),
                child: const Text('取消'),
              ),
            _round(
              label: '搜索',
              onTap: () => setState(() => _searching = true),
              child: const Icon(Icons.search, size: 22),
            ),
            const SizedBox(width: 8),
            _round(
              label: '更多',
              onTap: () => setState(() => _menu = true),
              child: const Icon(Icons.more_horiz, size: 22),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body(bool showHero, List<Map<String, dynamic>> visible) {
    if (!_ready) return const Center(child: CircularProgressIndicator());
    Widget content;
    if (_error != null && _notes.isEmpty) {
      content = Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(_error!, textAlign: TextAlign.center),
        ),
      );
    } else if (showHero) {
      return RefreshIndicator(onRefresh: _reload, child: const _EmptyHero());
    } else if (visible.isEmpty) {
      content = const Center(
        child: Text('没有文件', style: TextStyle(color: _sub)),
      );
    } else {
      return RefreshIndicator(
        onRefresh: _reload,
        child: ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 120),
          itemCount: visible.length,
          itemBuilder: (_, index) => _tile(visible[index]),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _reload,
      child: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: SizedBox(height: constraints.maxHeight, child: content),
        ),
      ),
    );
  }

  Widget _tagFilters() => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    child: Row(
      children: [
        for (final tag in _allTags)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilterChip(
              shape: const StadiumBorder(),
              label: Text('#$tag'),
              selected: _tags.contains(tag),
              onSelected: (_) => setState(() {
                if (!_tags.add(tag)) _tags.remove(tag);
              }),
            ),
          ),
      ],
    ),
  );

  Widget _tile(Map<String, dynamic> note) {
    final id = '${note['id']}';
    final type = note['type'] as String?;
    final audio = note['audio'];
    final duration = audio is Map ? audio['duration_ms'] : null;
    final host = sourceHost(note['source_url']);
    final unread =
        ChatUnreadScope.maybeOf(context)?.unreadForNote(id, _machine) ?? 0;
    return InkWell(
      onLongPress: () => setState(() {
        _selecting = true;
        _menu = false;
        _selected.add(id);
      }),
      onTap: () {
        if (_selecting) {
          setState(() {
            if (!_selected.add(id)) _selected.remove(id);
          });
          return;
        }
        _open(note);
      },
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 15, 10, 15),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: _line)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${note['title'] ?? ''}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 15.5, height: 1.4),
                  ),
                  const SizedBox(height: 7),
                  Wrap(
                    spacing: 12,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      _Meta(
                        icon: noteIcon(type),
                        color: noteColor(type),
                        text: noteTypeLabel(type),
                      ),
                      Text(
                        formatWhen(note['updated_at'] as String?),
                        style: const TextStyle(fontSize: 12, color: _sub),
                      ),
                      if (duration is num && duration > 0)
                        _Meta(
                          icon: Icons.schedule,
                          text: clockFromMs(duration.toInt()),
                        ),
                      if (host != null) _Meta(icon: Icons.link, text: host),
                      for (final tag in noteTags(note))
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE5E5EA),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            tag,
                            style: const TextStyle(
                              fontSize: 10.5,
                              color: Color(0xFF6C6C70),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            if (unread > 0)
              Padding(
                padding: const EdgeInsets.only(left: 8, top: 4),
                child: ChatUnreadBadge(count: unread),
              ),
            if (_selecting)
              Padding(
                padding: const EdgeInsets.only(left: 8, top: 8),
                child: Icon(
                  _selected.contains(id)
                      ? Icons.check_box
                      : Icons.check_box_outline_blank,
                  size: 22,
                  color: _selected.contains(id)
                      ? _dark
                      : const Color(0xFFE5E5EA),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _selectBar() {
    return Material(
      color: Colors.white,
      elevation: 12,
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Row(
            children: [
              _bar('标记', Icons.tag, _selected.isEmpty ? null : _tagChosen),
              _bar(
                _tagging ? '正在标记' : 'AI 标记',
                Icons.auto_fix_high,
                _selected.isEmpty || _tagging ? null : _aiTagChosen,
              ),
              _bar('导出', Icons.ios_share, null),
              _bar(
                _naming ? '正在命名' : 'AI 命名',
                Icons.auto_fix_high,
                _selected.isEmpty || _naming ? null : _aiNameChosen,
              ),
              _bar(
                '重命名',
                Icons.edit_outlined,
                _selected.length == 1 ? _renameChosen : null,
              ),
              _bar(
                '简介',
                Icons.info_outline,
                _selected.isEmpty ? null : _showInfo,
              ),
              _bar(
                '删除',
                Icons.delete_outline,
                _selected.isEmpty ? null : _deleteChosen,
                color: _red,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _bar(
    String label,
    IconData icon,
    VoidCallback? onTap, {
    Color? color,
  }) {
    final paint = onTap == null ? _sub : (color ?? _ink);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: paint, size: 20),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(color: paint, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _menuLayer() {
    return Positioned.fill(
      child: GestureDetector(
        onTap: () => setState(() => _menu = false),
        child: ColoredBox(
          color: const Color(0x2E000000),
          child: SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: Padding(
                padding: const EdgeInsets.only(top: 58, right: 14),
                child: GestureDetector(
                  onTap: () {},
                  child: Material(
                    color: const Color(0xF8FAFAFC),
                    borderRadius: BorderRadius.circular(26),
                    elevation: 16,
                    child: SizedBox(
                      width: 250,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _menuItem(Icons.swap_vert, '排序方式', _chooseSort),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _menuItem(IconData icon, String label, VoidCallback onTap) {
    return InkWell(
      onTap: () {
        setState(() => _menu = false);
        onTap();
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        child: Row(
          children: [
            Icon(icon, size: 22, color: const Color(0xFF3A3A3C)),
            const SizedBox(width: 16),
            Text(label, style: const TextStyle(fontSize: 17)),
          ],
        ),
      ),
    );
  }

  Widget _drawer() {
    return Drawer(
      width: 318,
      backgroundColor: _bg,
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 12),
                child: _round(
                  label: '退出登录',
                  onTap: widget.session.logout,
                  child: const Icon(Icons.person_outline, size: 22),
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 12),
              child: Text(
                '文件',
                style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800),
              ),
            ),
            _nav(
              '全部',
              Icons.layers_outlined,
              const Color(0xFF3DBE6A),
              _kind == null && _tags.isEmpty,
              () => _pickKind(null),
            ),
            _nav(
              '音频',
              Icons.mic_none,
              _blue,
              _kind == 'recording',
              () => _pickKind('recording'),
            ),
            _nav(
              '笔记',
              Icons.notes,
              const Color(0xFFE6A23C),
              _kind == 'note',
              () => _pickKind('note'),
            ),
            _nav(
              '剪藏',
              Icons.link,
              const Color(0xFFF07B3F),
              _kind == 'clip',
              () => _pickKind('clip'),
            ),
            _nav('回收站', Icons.delete_outline, _red, false, null),
            const Padding(
              padding: EdgeInsets.fromLTRB(38, 22, 20, 8),
              child: Text(
                '标签',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
            ),
            const Divider(indent: 18, endIndent: 18, color: Color(0xFFDCDCE1)),
            for (final tag in _allTags)
              _nav(
                '#$tag',
                Icons.tag,
                _ink,
                _tags.contains(tag),
                () => _pickTag(tag),
              ),
          ],
        ),
      ),
    );
  }

  void _pickKind(String? kind) {
    setState(() {
      _kind = kind;
      _selecting = false;
      _selected.clear();
    });
    Navigator.pop(context);
  }

  void _pickTag(String tag) {
    setState(() {
      if (!_tags.add(tag)) _tags.remove(tag);
      _selecting = false;
      _selected.clear();
    });
    Navigator.pop(context);
  }

  Widget _nav(
    String label,
    IconData icon,
    Color color,
    bool on,
    VoidCallback? onTap,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 18),
      child: ListTile(
        enabled: onTap != null,
        selected: on,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        selectedTileColor: const Color(0xFFE3E3E8),
        leading: Icon(icon, color: onTap == null ? _sub : color),
        title: Text(
          label,
          style: TextStyle(color: onTap == null ? _sub : _ink),
        ),
        onTap: onTap,
      ),
    );
  }
}

class _EmptyHero extends StatelessWidget {
  const _EmptyHero();

  @override
  Widget build(BuildContext context) {
    const lines = [
      (Icons.edit_outlined, '语音记录、思考笔记、网课播客、图文剪藏，记录一切，没有限制。'),
      (Icons.bolt_outlined, '无限记录、无限转译、无限剪藏，轻而易记，极简极致，极其享受。'),
      (Icons.wifi_off_outlined, '采用精调的端侧转录、翻译模型和本地存储，这就是保护隐私的最佳方式。'),
      (Icons.hub_outlined, '续写润色、提炼要点、上下文连贯记忆、深度问答 —— 你的全能 AI 写作助手。'),
    ];
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(26, 70, 26, 140),
      children: [
        const Text(
          '在这里，\n记录你的一切。',
          style: TextStyle(
            fontSize: 33,
            height: 1.75,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 34),
        for (final line in lines)
          Padding(
            padding: const EdgeInsets.only(bottom: 26),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(line.$1, size: 22),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    line.$2,
                    style: const TextStyle(fontSize: 15, height: 1.6),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class EditExitGuard extends StatefulWidget {
  const EditExitGuard({
    super.key,
    required this.editing,
    required this.busy,
    required this.popping,
    required this.onDiscard,
    required this.child,
  });
  final bool editing, busy, popping;
  final Future<void> Function() onDiscard;
  final Widget child;

  @override
  State<EditExitGuard> createState() => _EditExitGuardState();
}

class _EditExitGuardState extends State<EditExitGuard> {
  bool _confirming = false;
  double _dragDistance = 0;

  Future<void> _confirmExit() async {
    if (!mounted ||
        !widget.editing ||
        widget.busy ||
        widget.popping ||
        _confirming) {
      return;
    }
    _confirming = true;
    try {
      final discard = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('放弃修改？'),
          content: const Text('未保存的修改将丢失。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('放弃'),
            ),
          ],
        ),
      );
      if (discard == true && mounted && !widget.busy) await widget.onDiscard();
    } finally {
      _confirming = false;
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: widget.popping || (!widget.editing && !widget.busy),
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop) _confirmExit();
    },
    child: Stack(
      children: [
        widget.child,
        if (widget.editing && Theme.of(context).platform == TargetPlatform.iOS)
          PositionedDirectional(
            start: 0,
            top: 0,
            bottom: 0,
            width: 24,
            child: GestureDetector(
              key: const ValueKey('edit-back-edge'),
              behavior: HitTestBehavior.translucent,
              onHorizontalDragStart: (_) => _dragDistance = 0,
              onHorizontalDragUpdate: (details) =>
                  _dragDistance += details.primaryDelta ?? 0,
              onHorizontalDragEnd: (_) {
                if (_dragDistance >= 80) _confirmExit();
              },
            ),
          ),
      ],
    ),
  );
}

class NoteEditor extends StatefulWidget {
  const NoteEditor({
    super.key,
    required this.api,
    required this.machine,
    this.note,
    this.showTranscript = true,
    this.focusTranscript = false,
    this.imagePicker,
  });
  final MulticaApi api;
  final String? machine;
  final Map<String, dynamic>? note;
  final bool showTranscript;
  final bool focusTranscript;
  final ImagePicker? imagePicker;

  @override
  State<NoteEditor> createState() => _NoteEditorState();
}

class _NoteEditorState extends State<NoteEditor> {
  late final _title = TextEditingController(
    text: widget.note?['title'] as String? ?? '',
  );
  late final _body = TextEditingController(
    text: widget.note?['content'] as String? ?? '',
  );
  late final _transcript = TextEditingController(
    text: widget.note?['transcript'] as String? ?? '',
  );
  late final List<String> _tags = noteTags(widget.note ?? const {});
  late final _titleFocus = FocusNode();
  UndoHistoryController _history = UndoHistoryController();
  Map<String, dynamic>? _note;
  var _editing = false;
  var _focusTitle = false;
  var _changed = false;
  var _saving = false;
  var _popping = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _note = widget.note == null
        ? null
        : Map<String, dynamic>.from(widget.note!);
    _editing = widget.note == null;
    _history.addListener(_refresh);
    _body.addListener(_refresh);
    _transcript.addListener(_refresh);

    if (_note?['type'] == 'clip') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_openPendingClipChat());
      });
    }
  }

  Future<void> _openPendingClipChat() async {
    final machine = widget.machine;
    if (machine == null || _note == null) return;
    try {
      final latest = await widget.api.getNote(machine, '${_note!['id']}');
      if (!mounted || _editing || _popping) return;
      setState(() {
        _note = latest;
        _title.text = '${latest['title']}';
        _body.text = '${latest['content'] ?? ''}';
      });
      if (_body.text.trim().isNotEmpty ||
          ModalRoute.of(context)?.isCurrent != true) {
        return;
      }
      await showNoteAiChat(
        context,
        api: widget.api,
        machine: machine,
        note: latest,
      );
      if (!mounted) return;
      final updated = await widget.api.getNote(machine, '${latest['id']}');
      if (!mounted || _editing) return;
      setState(() {
        _note = updated;
        _title.text = '${updated['title']}';
        _body.text = '${updated['content'] ?? ''}';
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _history.removeListener(_refresh);
    _body.removeListener(_refresh);
    _transcript.removeListener(_refresh);
    _titleFocus.dispose();
    _title.dispose();
    _body.dispose();
    _transcript.dispose();
    _history.dispose();
    super.dispose();
  }

  void _beginEdit({bool title = false}) {
    if (_editing) return;
    _focusTitle = title;
    if (!_body.selection.isValid) {
      _body.selection = TextSelection.collapsed(offset: _body.text.length);
    }
    final previous = _history;
    previous.removeListener(_refresh);
    _history = UndoHistoryController()..addListener(_refresh);
    setState(() {
      _editing = true;
      _error = null;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      previous.dispose();
      if (title && mounted) _titleFocus.requestFocus();
    });
  }

  Future<void> _discard() async {
    if (_saving || _popping) return;
    setState(() => _saving = true);
    await _stopEditorVoice(_body);
    await _stopEditorVoice(_transcript);
    if (mounted) _leave();
  }

  void _leave() {
    if (_popping) return;
    setState(() => _popping = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.pop(context, _changed);
    });
  }

  Future<void> _persist() async {
    final machine = widget.machine;
    if (machine == null) return;
    final title = _title.text.trim().isEmpty ? '无标题' : _title.text.trim();
    final existing = _note;
    final saved = existing == null
        ? await widget.api.createNote({
            'share_machine': machine,
            'type': 'note',
            'title': title,
            'content': _body.text,
            'tags': _tags,
          })
        : await widget.api.updateNote('${existing['id']}', {
            'share_machine': machine,
            'revision': existing['revision'],
            'title': title,
            'tags': _tags,
            'content': _body.text,
            'transcript': _transcript.text,
          });
    _note = saved;
    _changed = true;
    if (mounted) {
      setState(() => _title.text = '${saved['title'] ?? title}');
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _stopEditorVoice(_body);
      await _stopEditorVoice(_transcript);
      await _persist();
      if (!mounted) return;
      setState(() => _editing = false);
      FocusManager.instance.primaryFocus?.unfocus();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete() async {
    final existing = _note;
    final machine = widget.machine;
    if (existing == null || machine == null) return;
    await widget.api.deleteNote(
      '${existing['id']}',
      machine,
      '${existing['revision']}',
    );
    _changed = true;
    _leave();
  }

  Future<void> _rename() async {
    final controller = TextEditingController(text: _title.text);
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('重命名'),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('完成'),
          ),
        ],
      ),
    );
    Future<void>.delayed(const Duration(milliseconds: 350), controller.dispose);
    if (!mounted || title == null || title.isEmpty) return;
    final previous = _title.text;
    _title.text = title;
    try {
      await _persist();
    } catch (error) {
      _title.text = previous;
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _confirmDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: const Text('删除这篇笔记？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除', style: TextStyle(color: _red)),
          ),
        ],
      ),
    );
    if (ok == true) await _delete();
  }

  Future<void> _markTag() async {
    final machine = widget.machine;
    if (machine == null || _note == null || _saving) return;
    setState(() => _saving = true);
    try {
      final notes = await widget.api.notes(machine);
      if (!mounted) return;
      final tags = {for (final note in notes) ...noteTags(note)}.toList()
        ..sort();
      final tag = await pickNoteTag(context, tags: tags);
      if (tag == null || _tags.contains(tag) || !mounted) return;
      setState(() => _tags.add(tag));
      try {
        await _persist();
      } catch (_) {
        _tags.remove(tag);
        rethrow;
      }
      if (mounted) setState(() => _error = null);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _aiTag() async {
    final machine = widget.machine;
    if (machine == null || _note == null || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final updated = await widget.api.tagNote(
        machine,
        '${_note!['id']}',
        revision: '${_note!['revision']}',
      );
      if (!mounted) return;
      setState(() {
        _note = updated;
        _tags
          ..clear()
          ..addAll(noteTags(updated));
        _changed = true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    final machine = widget.machine;
    if (machine == null || _saving) return;
    setState(() => _saving = true);
    try {
      final selected = await MediaService(widget.api)
          .pickImage(source, picker: widget.imagePicker);
      if (!mounted || selected == null) return;
      if (_note == null) await _persist();
      if (!mounted) return;
      await widget.api.uploadMedia(
        machine: machine,
        noteId: '${_note!['id']}',
        name: selected.name,
        contentType: selected.contentType,
        bytes: selected.bytes,
      );
      insertMarkdownImage(_body, '${_note!['id']}', selected.name);
      if (mounted) setState(() => _error = null);
    } catch (error) {
      if (mounted) setState(() => _error = '图片未插入，原有文字已保留。$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _editor(TextEditingController controller) {
    return _MarkdownEditor(
      controller: controller,
      history: _history,
      editing: _editing,
      onBeginEdit: null,
      autofocus: !_focusTitle,

      onCamera: () => _pickImage(ImageSource.camera),
      onGallery: () => _pickImage(ImageSource.gallery),
      mediaApi: widget.api,
      mediaMachine: widget.machine,
      mediaNoteId: _note?['id'] as String?,
    );
  }

  Future<void> _ai() async {
    final machine = widget.machine;
    if (machine == null || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _persist();
      if (!mounted) return;
      setState(() => _editing = false);
      await showNoteAiChat(
        context,
        api: widget.api,
        machine: machine,
        note: _note!,
      );
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return EditExitGuard(
      editing: _editing,
      busy: _saving,
      popping: _popping,
      onDiscard: _discard,
      child: Scaffold(
        resizeToAvoidBottomInset: false,
        backgroundColor: Colors.white,
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          automaticallyImplyLeading: false,
          leadingWidth: _editing ? 80 : null,
          leading: _editing
              ? TextButton(
                  onPressed: _saving ? null : _discard,
                  child: const Text(
                    '放弃',
                    style: TextStyle(color: _ink, fontSize: 16),
                  ),
                )
              : IconButton(
                  tooltip: '返回',
                  onPressed: _leave,
                  icon: const Icon(Icons.arrow_back),
                ),
          centerTitle: false,
          titleSpacing: 0,
          title: _editing ? null : DetailTitle(_title.text),
          actions: [
            if (_editing) ...[
              IconButton(
                tooltip: '撤销',
                onPressed: _history.value.canUndo ? _history.undo : null,
                icon: const Icon(Icons.undo),
              ),
              IconButton(
                tooltip: '重做',
                onPressed: _history.value.canRedo ? _history.redo : null,
                icon: const Icon(Icons.redo),
              ),
              TextButton(
                onPressed: _saving ? null : _save,
                child: const Text(
                  '保存',
                  style: TextStyle(color: _blue, fontWeight: FontWeight.w600),
                ),
              ),
            ] else if (_note != null) ...[
              AiChatButton(
                noteId: '${_note!['id']}',
                machine: widget.machine,
                onPressed: _saving ? null : _ai,
              ),
              NoteActions(
                note: _note!,
                enabled: !_saving,
                onEdit: _beginEdit,
                onTag: _markTag,
                onAiTag: _aiTag,
                onRename: _rename,
                onDelete: _confirmDelete,
              ),
            ],
          ],
        ),
        body: Stack(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(
                16,
                0,
                16,
                16 + inputBottomInset(context),
              ),
              child: Column(
                children: [
                  if (_editing)
                    TextField(
                      controller: _title,
                      focusNode: _titleFocus,
                      readOnly: !_editing,
                      onTap: () => _beginEdit(title: true),
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                      ),
                      decoration: const InputDecoration(
                        hintText: '无标题',
                        border: InputBorder.none,
                      ),
                    ),
                  if (_error != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(_error!, style: const TextStyle(color: _red)),
                    ),
                  if (widget.focusTranscript) ...[
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text('语音原文', style: TextStyle(color: _sub)),
                    ),
                    Expanded(child: _editor(_transcript)),
                  ] else ...[
                    Expanded(child: _editor(_body)),
                    if (widget.showTranscript &&
                        _transcript.text.isNotEmpty) ...[
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: Text('语音原文', style: TextStyle(color: _sub)),
                      ),
                      SizedBox(
                        height: 220,
                        child: _MarkdownEditor(controller: _transcript),
                      ),
                    ],
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class RecordingDetail extends StatefulWidget {
  const RecordingDetail({
    super.key,
    required this.api,
    required this.machine,
    required this.note,
    this.imagePicker,
  });
  final MulticaApi api;
  final String machine;
  final Map<String, dynamic> note;
  final ImagePicker? imagePicker;

  @override
  State<RecordingDetail> createState() => _RecordingDetailState();
}

class _RecordingDetailState extends State<RecordingDetail> {
  final AudioPlayer _player = AudioPlayer();
  late Map<String, dynamic> _note = widget.note;
  late final _content = TextEditingController(
    text: '${widget.note['content'] ?? ''}',
  );
  late final _transcriptText = TextEditingController(
    text: '${widget.note['transcript'] ?? ''}',
  );
  late UndoHistoryController _contentHistory = UndoHistoryController();
  late UndoHistoryController _transcriptHistory = UndoHistoryController();
  var _tab = 0;
  var _editing = false;
  var _changed = false;
  var _saving = false;
  var _playing = false;
  var _loadingAudio = false;
  var _audioLoaded = false;
  var _playbackEnded = false;
  Duration _audioPosition = Duration.zero;
  Duration _audioDuration = Duration.zero;
  var _popping = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _player.onPlayerComplete.listen((_) {
      if (mounted) {
        setState(() {
          _playing = false;
          _playbackEnded = true;
          _audioPosition = _audioDuration;
        });
      }
    });
    _player.onPositionChanged.listen((value) {
      if (mounted) setState(() => _audioPosition = value);
    });
    _player.onDurationChanged.listen((value) {
      if (mounted) setState(() => _audioDuration = value);
    });
    _contentHistory.addListener(_rebuild);
    _transcriptHistory.addListener(_rebuild);
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _contentHistory.removeListener(_rebuild);
    _transcriptHistory.removeListener(_rebuild);
    _content.dispose();
    _transcriptText.dispose();
    _contentHistory.dispose();
    _transcriptHistory.dispose();
    _player.dispose();
    super.dispose();
  }

  Future<void> _togglePlayback() async {
    if (_loadingAudio) return;
    setState(() {
      _loadingAudio = true;
      _error = null;
    });
    try {
      if (_playing) {
        await _player.pause();
        if (mounted) setState(() => _playing = false);
        return;
      }
      if (_audioLoaded) {
        if (_playbackEnded) await _player.seek(Duration.zero);
        await _player.resume();
      } else {
        final audio = _note['audio'];
        if (audio is! Map || audio['file'] != 'audio.wav') {
          throw ApiException(404, '此录音没有保存原始音频，无法播放');
        }
        final bytes = await MediaService(widget.api).read(
          machine: widget.machine,
          noteId: '${_note['id']}',
          name: 'audio.wav',
        );
        if (!mounted) return;
        await _player.play(BytesSource(bytes, mimeType: 'audio/wav'));
      }
      if (mounted) {
        setState(() {
          _playing = true;
          _audioLoaded = true;
          _playbackEnded = false;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = '录音读取或播放失败，可重试：$error');
    } finally {
      if (mounted) setState(() => _loadingAudio = false);
    }
  }

  String _playbackTime(Duration value) {
    final minutes = value.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = value.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  UndoHistoryController get _activeHistory =>
      _tab == 0 ? _transcriptHistory : _contentHistory;

  void _beginEdit() {
    if (_editing) return;
    setState(() {
      _editing = true;
      _error = null;
    });
  }

  Future<void> _discard() async {
    if (_saving || _popping) return;
    setState(() => _saving = true);
    await _stopEditorVoice(_tab == 0 ? _transcriptText : _content);
    if (mounted) _leave();
  }

  void _closeEdit() {
    final previousContent = _contentHistory;
    final previousTranscript = _transcriptHistory;
    previousContent.removeListener(_rebuild);
    previousTranscript.removeListener(_rebuild);
    _contentHistory = UndoHistoryController()..addListener(_rebuild);
    _transcriptHistory = UndoHistoryController()..addListener(_rebuild);
    setState(() => _editing = false);
    FocusManager.instance.primaryFocus?.unfocus();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      previousContent.dispose();
      previousTranscript.dispose();
    });
  }

  void _leave() {
    if (_popping) return;
    setState(() => _popping = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.pop(context, _changed);
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _stopEditorVoice(_tab == 0 ? _transcriptText : _content);
      final saved = await widget.api.updateNote('${_note['id']}', {
        'share_machine': widget.machine,
        'revision': _note['revision'],
        'title': _note['title'] ?? '',
        'tags': noteTags(_note),
        'content': _content.text,
        'transcript': _transcriptText.text,
        'audio': _note['audio'],
      });
      if (!mounted) return;
      setState(() {
        _note = {..._note, ...saved};
        _changed = true;
      });
      _closeEdit();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final selected = await MediaService(widget.api)
          .pickImage(source, picker: widget.imagePicker);
      if (!mounted || selected == null) return;
      await widget.api.uploadMedia(
        machine: widget.machine,
        noteId: '${_note['id']}',
        name: selected.name,
        contentType: selected.contentType,
        bytes: selected.bytes,
      );
      insertMarkdownImage(_content, '${_note['id']}', selected.name);
      setState(() => _error = null);
    } catch (error) {
      if (mounted) setState(() => _error = '图片未插入，原有文字已保留。$error');
    }
  }

  Future<void> _confirmDelete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: const Text('删除这份音频？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除', style: TextStyle(color: _red)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.api.deleteNote(
        '${_note['id']}',
        widget.machine,
        '${_note['revision']}',
      );
      _changed = true;
      _leave();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _renameRecording() async {
    final controller = TextEditingController(text: '${_note['title']}');
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('重命名'),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('完成'),
          ),
        ],
      ),
    );
    Future<void>.delayed(const Duration(milliseconds: 350), controller.dispose);
    if (title == null || title.isEmpty || !mounted) return;
    setState(() => _saving = true);
    try {
      final updated = await widget.api.updateNote('${_note['id']}', {
        'share_machine': widget.machine,
        'revision': _note['revision'],
        'title': title,
        'tags': noteTags(_note),
        'content': _note['content'],
        'transcript': _note['transcript'],
        'audio': _note['audio'],
      });
      if (mounted) {
        setState(() {
          _note = updated;
          _changed = true;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _markTag() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final notes = await widget.api.notes(widget.machine);
      if (!mounted) return;
      final tags = {for (final note in notes) ...noteTags(note)}.toList()
        ..sort();
      final tag = await pickNoteTag(context, tags: tags);
      if (tag == null || noteTags(_note).contains(tag) || !mounted) return;
      final updated = await widget.api.updateNote('${_note['id']}', {
        'share_machine': widget.machine,
        'revision': _note['revision'],
        'title': _note['title'],
        'tags': [...noteTags(_note), tag],
        'content': _note['content'],
        'transcript': _note['transcript'],
        'audio': _note['audio'],
      });
      if (mounted) {
        setState(() {
          _note = updated;
          _changed = true;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _aiTag() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final updated = await widget.api.tagNote(
        widget.machine,
        '${_note['id']}',
        revision: '${_note['revision']}',
      );
      if (mounted) {
        setState(() {
          _note = updated;
          _changed = true;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _ai() async {
    if (_editing) {
      await _save();
      if (_error != null || !mounted) return;
    }
    await showNoteAiChat(
      context,
      api: widget.api,
      machine: widget.machine,
      note: _note,
    );
  }

  @override
  Widget build(BuildContext context) {
    final lines = parseTranscript('${_note['transcript'] ?? ''}');
    return EditExitGuard(
      editing: _editing,
      busy: _saving,
      popping: _popping,
      onDiscard: _discard,
      child: Scaffold(
        resizeToAvoidBottomInset: false,
        backgroundColor: Colors.white,
        body: SafeArea(
          minimum: EdgeInsets.only(bottom: inputBottomInset(context)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: 54,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Row(
                    children: [
                      if (_editing)
                        TextButton(
                          onPressed: _saving ? null : _discard,
                          child: const Text(
                            '放弃',
                            style: TextStyle(color: _ink, fontSize: 16),
                          ),
                        )
                      else
                        _round(
                          label: '返回',
                          onTap: _leave,
                          child: const Icon(Icons.arrow_back, size: 22),
                        ),
                      Expanded(child: DetailTitle('${_note['title'] ?? ''}')),
                      if (!_editing) ...[
                        AiChatButton(
                          noteId: '${_note['id']}',
                          machine: widget.machine,
                          onPressed: _saving ? null : _ai,
                        ),
                        NoteActions(
                          note: _note,
                          enabled: !_saving,
                          onEdit: _beginEdit,
                          onTag: _markTag,
                          onAiTag: _aiTag,
                          onRename: _renameRecording,
                          onDelete: _confirmDelete,
                        ),
                      ],
                      if (_editing) ...[
                        IconButton(
                          tooltip: '撤销',
                          onPressed: _activeHistory.value.canUndo
                              ? _activeHistory.undo
                              : null,
                          icon: const Icon(Icons.undo),
                        ),
                        IconButton(
                          tooltip: '重做',
                          onPressed: _activeHistory.value.canRedo
                              ? _activeHistory.redo
                              : null,
                          icon: const Icon(Icons.redo),
                        ),
                        TextButton(
                          onPressed: _saving ? null : _save,
                          child: const Text(
                            '保存',
                            style: TextStyle(
                              color: _blue,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  children: [
                    _tabButton('原文', 0),
                    const SizedBox(width: 22),
                    _tabButton('笔记', 1),
                  ],
                ),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
                  child: Text(_error!, style: const TextStyle(color: _red)),
                ),
              const SizedBox(height: 8),
              Expanded(child: _editing ? _editors() : _reading(lines)),
              if (!_editing)
                Padding(
                  padding: const EdgeInsets.only(bottom: 20),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (_audioLoaded)
                          SizedBox(
                            width: 280,
                            child: Column(
                              children: [
                                Slider(
                                  min: 0,
                                  max: _audioDuration.inMilliseconds > 0
                                      ? _audioDuration.inMilliseconds.toDouble()
                                      : 1,
                                  value: _audioPosition.inMilliseconds
                                      .clamp(
                                        0,
                                        _audioDuration.inMilliseconds > 0
                                            ? _audioDuration.inMilliseconds
                                            : 1,
                                      )
                                      .toDouble(),
                                  onChanged: (value) => _player.seek(
                                    Duration(milliseconds: value.round()),
                                  ),
                                ),
                                Text(
                                  '${_playbackTime(_audioPosition)} / ${_playbackTime(_audioDuration)}',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: _sub,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ActionPill(
                          children: [
                            PillButton(
                              dark: true,
                              icon: _loadingAudio
                                  ? Icons.hourglass_top
                                  : (_playing ? Icons.pause : Icons.play_arrow),
                              label: _loadingAudio
                                  ? '读取中'
                                  : (_playing
                                        ? '暂停'
                                        : (_note['audio'] is Map &&
                                                  (_note['audio']
                                                          as Map)['file'] ==
                                                      'audio.wav'
                                              ? '播放'
                                              : '无原始录音')),
                              onPressed:
                                  _note['audio'] is Map &&
                                      (_note['audio'] as Map)['file'] ==
                                          'audio.wav'
                                  ? _togglePlayback
                                  : null,
                            ),
                            PillButton(
                              icon: Icons.auto_awesome,
                              label: 'AI+',
                              onPressed: _ai,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tabButton(String label, int index) {
    final on = _tab == index;
    return GestureDetector(
      onTap: () async {
        await _stopEditorVoice(_tab == 0 ? _transcriptText : _content);
        if (mounted) setState(() => _tab = index);
      },
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: on ? FontWeight.w700 : FontWeight.w400,
              color: on ? _ink : _sub,
            ),
          ),
          const SizedBox(height: 6),
          Container(
            height: 2.5,
            width: 28,
            color: on ? _ink : Colors.transparent,
          ),
        ],
      ),
    );
  }

  Widget _reading(List<TranscriptSegment> lines) {
    return _tab == 0 ? _transcript(lines) : _noteBody();
  }

  Widget _editors() {
    final transcript = _tab == 0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: _MarkdownEditor(
        key: ValueKey(transcript ? 'transcript' : 'content'),
        controller: transcript ? _transcriptText : _content,
        history: transcript ? _transcriptHistory : _contentHistory,
        editing: true,
        onCamera: () => _pickImage(ImageSource.camera),
        onGallery: () => _pickImage(ImageSource.gallery),
        mediaApi: widget.api,
        mediaMachine: widget.machine,
        mediaNoteId: '${_note['id']}',
      ),
    );
  }

  Widget _transcript(List<TranscriptSegment> lines) {
    if (lines.isEmpty) {
      final raw = '${_note['transcript'] ?? ''}'.trim();
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: null,
        child: Align(
          alignment: Alignment.topLeft,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
            child: Text(
              raw.isEmpty ? '还没有原文' : raw,
              style: TextStyle(color: raw.isEmpty ? _sub : _ink, fontSize: 16),
            ),
          ),
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
          children: [
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: null,
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final line in lines) ...[
                      Text(
                        line.clock,
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: Color(0xFFA0A0A5),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        line.text,
                        style: const TextStyle(fontSize: 15.5, height: 1.6),
                      ),
                      const SizedBox(height: 20),
                    ],
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _noteBody() {
    final content = '${_note['content'] ?? ''}'.trim();
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: null,
      child: Align(
        alignment: Alignment.topLeft,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: content.isEmpty
              ? const Text('还没有笔记', style: TextStyle(color: _sub, fontSize: 16))
              : IMindMarkdown(
                  data: content,
                  api: widget.api,
                  machine: widget.machine,
                  noteId: '${_note['id']}',
                ),
        ),
      ),
    );
  }
}

class RecordPage extends StatefulWidget {
  const RecordPage({
    super.key,
    required this.api,
    required this.machine,
    this.recorder,
    this.imagePicker,
  });
  final AudioRecorder? recorder;
  final ImagePicker? imagePicker;
  final MulticaApi api;
  final String machine;

  @override
  State<RecordPage> createState() => _RecordPageState();
}

class _LiveLine {
  _LiveLine(this.id, this.startMs, this.text, this.done);
  final int id;
  int startMs;
  String text;
  bool done;
}

class _RecordPageState extends State<RecordPage> {
  late final _recorder = widget.recorder ?? AudioRecorder();
  final _lines = <_LiveLine>[];
  final _pcm = BytesBuilder(copy: false);
  final _pendingImages = <PickedImage>[];
  Map<String, dynamic>? _savedNote;
  bool _namingFailed = false;
  Uint8List? _pendingWav;
  final _noteTitle = TextEditingController();
  final _noteBody = TextEditingController();
  final _elapsed = ValueNotifier<Duration>(Duration.zero);
  final _live = ValueNotifier<bool>(false);
  AsrSession? _socket;
  StreamSubscription<dynamic>? _audio;
  var _connecting = false;
  var _saving = false;
  var _finalizing = false;
  var _sessionOffsetMs = 0;
  var _pcmLength = 0;
  Timer? _clock;
  var _started = DateTime.now();
  var _recording = false;
  String? _status;

  Future<void> _start() async {
    if (_recording || _connecting || _finalizing || _saving) return;
    setState(() {
      _connecting = true;
      _status = '正在连接语音服务...';
    });
    AsrSession? channel;
    try {
      if (!await _recorder.hasPermission()) {
        throw ApiException(0, '需要麦克风权限才能转写');
      }
      if (!mounted) return;
      // An HTTP preflight lets expired sessions follow the shared 401 flow.
      final shares = await widget.api.shares();
      if (!shares.any((share) => share['machine'] == widget.machine)) {
        throw ApiException(403, '共享知识库已断开，请返回首页重新选择');
      }
      if (!mounted) return;
      await _socket?.close();
      _sessionOffsetMs = _elapsed.value.inMilliseconds;
      final ids = <int, int>{};
      channel = AsrSession.connect(
        api: widget.api,
        machine: widget.machine,
        onMessage: (data) {
          if (!mounted) return;
          if (data['type'] == 'partial' || data['type'] == 'final') {
            final id = data['sentence_id'] as int;
            final localId = ids.putIfAbsent(id, () => _lines.length);
            final start = data['start_ms'] as int?;
            _apply({
              ...data,
              'sentence_id': localId,
              if (start != null && start >= 0)
                'start_ms': _sessionOffsetMs + start,
            });
          } else {
            _apply(data);
          }
        },
      );
      _socket = channel;
      await channel.start();
      if (!mounted) {
        await channel.close();
        return;
      }
      final stream = await _recorder.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: 16000,
          numChannels: 1,
        ),
      );
      if (!mounted) {
        await _recorder.stop();
        await channel.close();
        return;
      }
      _audio = stream.listen(
        (dynamic chunk) {
          if (chunk is List<int>) {
            const maxPcmBytes = (64 << 20) - 44;
            final remaining = (maxPcmBytes - _pcmLength) & ~1;
            if (chunk.length <= remaining) {
              _pcm.add(chunk);
              _pcmLength += chunk.length;
            } else {
              if (remaining > 0) {
                _pcm.add(chunk.take(remaining).toList(growable: false));
                _pcmLength += remaining;
              }
              if (mounted) {
                setState(() => _status = '已达到约 35 分钟的原始音频保存上限，录音已停止；可以保存已录内容。');
              }
              if (_recording && !_finalizing) {
                unawaited(_stop());
              }
            }
          }
          channel!.sendAudio(chunk as List<int>);
        },
        onError: (Object _) {
          if (mounted) setState(() => _status = '麦克风采集失败，已收到的转写仍可保存');
        },
      );
      _started = DateTime.now();
      _clock?.cancel();
      _clock = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) {
          _elapsed.value =
              Duration(milliseconds: _sessionOffsetMs) +
              DateTime.now().difference(_started);
        }
      });
      _live.value = true;
      setState(() {
        _recording = true;
        _status = null;
      });
    } catch (error) {
      await channel?.close();
      if (mounted) setState(() => _status = '$error');
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  void _apply(Map<String, dynamic> data) {
    final type = data['type'];
    if (type != 'partial' && type != 'final') {
      if (type == 'error' && mounted) {
        setState(
          () => _status = '${data['error'] ?? data['message'] ?? '转写失败'}',
        );
        if (_recording && !_finalizing) unawaited(_stop());
      }
      return;
    }
    final text = '${data['text'] ?? ''}'.trim();
    if (text.isEmpty) return;
    final id = (data['sentence_id'] as num?)?.toInt() ?? _lines.length;
    final start = (data['start_ms'] as num?)?.toInt() ?? -1;
    setState(() {
      final index = _lines.indexWhere((line) => line.id == id);
      if (index >= 0) {
        _lines[index]
          ..startMs = start < 0 ? _lines[index].startMs : start
          ..text = text
          ..done = type == 'final';
      } else {
        _lines.add(_LiveLine(id, start < 0 ? 0 : start, text, type == 'final'));
      }
    });
  }

  Future<void> _stop() async {
    if (_finalizing) return;
    setState(() => _finalizing = true);
    _clock?.cancel();
    _elapsed.value =
        Duration(milliseconds: _sessionOffsetMs) +
        DateTime.now().difference(_started);
    _live.value = false;
    try {
      await _recorder.stop();
      await _audio?.cancel();
      await _socket?.finish();
    } catch (error) {
      if (mounted) setState(() => _status = '$error');
    } finally {
      if (mounted) {
        setState(() {
          _recording = false;
          _finalizing = false;
        });
      }
    }
  }

  Future<void> _askSave() async {
    if (_connecting || _saving || _finalizing) return;
    final action = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: _bg,
        title: const Text(
          '确定结束录音并保存？',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w500,
            color: Color(0xFF555555),
          ),
        ),
        actionsAlignment: MainAxisAlignment.spaceEvenly,
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, 'pause'),
            child: const Text(
              '暂停',
              style: TextStyle(
                color: _ink,
                fontWeight: FontWeight.w700,
                fontSize: 17,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, 'save'),
            child: const Text(
              '保存',
              style: TextStyle(
                color: _blue,
                fontWeight: FontWeight.w700,
                fontSize: 17,
              ),
            ),
          ),
        ],
      ),
    );
    if (!mounted || action == null) return;
    if (_recording) await _stop();
    if (action == 'save') await _save();
  }

  Future<void> _save() async {
    await _saveRecording(closeOnSuccess: true);
  }

  Future<bool> _saveRecording({required bool closeOnSuccess}) async {
    if (_saving) return false;
    setState(() => _saving = true);
    final titleSource = _noteTitle.text.trim().isNotEmpty
        ? _noteTitle.text.trim()
        : (_lines.isEmpty ? '录音' : _lines.first.text);
    final title = titleSource.length > 40
        ? titleSource.substring(0, 40)
        : titleSource;
    final transcript = formatTranscript([
      for (final line in _lines)
        TranscriptSegment(
          stamp: stampFromMs(line.startMs),
          text: line.text,
          startMs: line.startMs,
        ),
    ]);
    try {
      _pendingWav = pcm16MonoWav(_pcm.toBytes());
      final payload = <String, dynamic>{
        'share_machine': widget.machine,
        'type': 'recording',
        'title': title,
        'content': _noteBody.text.trim().isEmpty ? '# 录音笔记' : _noteBody.text,
        'transcript': transcript,
        if (_pendingWav!.length > 44)
          'audio': {
            'duration_ms': _pcmLength ~/ 32,
            'format': 'wav_pcm_s16le',
            'sample_rate_hz': 16000,
            'file': 'audio.wav',
          },
      };
      final updatePayload = Map<String, dynamic>.from(payload)..remove('type');
      _savedNote = _savedNote == null
          ? await widget.api.createNote(payload)
          : await widget.api.updateNote('${_savedNote!['id']}', {
              ...updatePayload,
              'revision': _savedNote!['revision'],
              'tags': noteTags(_savedNote!),
            });
      if (_pendingWav!.length > 44) {
        await widget.api.uploadMedia(
          machine: widget.machine,
          noteId: '${_savedNote!['id']}',
          name: 'audio.wav',
          contentType: 'audio/wav',
          bytes: _pendingWav!,
        );
      }
      if (_pendingImages.isNotEmpty) {
        var updatedContent = _noteBody.text;
        for (final image in _pendingImages) {
          if (!updatedContent.contains('pending:${image.name}')) continue;
          await widget.api.uploadMedia(
            machine: widget.machine,
            noteId: '${_savedNote!['id']}',
            name: image.name,
            contentType: image.contentType,
            bytes: image.bytes,
          );
          updatedContent = updatedContent.replaceAll(
            'pending:${image.name}',
            'media/${_savedNote!['id']}/${image.name}',
          );
        }
        _savedNote = await widget.api.updateNote('${_savedNote!['id']}', {
          'share_machine': widget.machine,
          'revision': _savedNote!['revision'],
          'title': _savedNote!['title'],
          'tags': noteTags(_savedNote!),
          'content': updatedContent,
          'transcript': _savedNote!['transcript'],
          'audio': _savedNote!['audio'],
        });
        _noteBody.value = _noteBody.value.copyWith(text: updatedContent);
        _pendingImages.clear();
      }
      try {
        _savedNote = await widget.api.nameNote(
          widget.machine,
          '${_savedNote!['id']}',
          '${_savedNote!['revision']}',
        );
        _noteTitle.text = '${_savedNote!['title']}';
        _namingFailed = false;
      } catch (error) {
        if (mounted) {
          setState(() {
            _namingFailed = true;
            _status = '录音已保存，AI 命名失败：$error';
          });
        }
        if (closeOnSuccess) return false;
      }
      if (mounted && closeOnSuccess) Navigator.pop(context, true);
      return true;
    } catch (error) {
      if (mounted) setState(() => _status = '$error');
      return false;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _retryRecordingName() async {
    final note = _savedNote;
    if (note == null || _saving) return;
    setState(() => _saving = true);
    try {
      _savedNote = await widget.api.nameNote(
        widget.machine,
        '${note['id']}',
        '${note['revision']}',
      );
      _noteTitle.text = '${_savedNote!['title']}';
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _status = '录音已保存，AI 命名失败：$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _sideNote() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _SideNote(
          api: widget.api,
          machine: widget.machine,
          title: _noteTitle,
          body: _noteBody,
          elapsed: _elapsed,
          live: _live,
          onAi: _openAiFromSideNote,
          onPickImage: _pickPendingImage,
          pendingImages: _pendingImages,
          currentNoteId: () => _savedNote?['id'] as String?,
        ),
      ),
    );
  }

  Future<PickedImage?> _pickPendingImage(ImageSource source) async {
    final image = await MediaService(widget.api)
        .pickImage(source, picker: widget.imagePicker);
    if (image != null) _pendingImages.add(image);
    return image;
  }

  Future<void> _openAiFromSideNote() async {
    if (_recording) await _stop();
    final saved = await _saveRecording(closeOnSuccess: false);
    final note = _savedNote;
    if (!mounted || !saved || note == null) return;
    await showNoteAiChat(
      context,
      api: widget.api,
      machine: widget.machine,
      note: note,
    );
  }

  Future<void> _back() async {
    if (_connecting || _saving || _finalizing) return;
    if (_recording) {
      await _askSave();
      return;
    }
    if (_lines.isNotEmpty ||
        _pcmLength > 0 ||
        _pendingImages.isNotEmpty ||
        _noteBody.text.isNotEmpty) {
      await _askSave();
      return;
    }
    if (mounted) Navigator.pop(context, false);
  }

  @override
  void dispose() {
    _clock?.cancel();
    _audio?.cancel();
    _socket?.close();
    _recorder.dispose();
    _noteTitle.dispose();
    _noteBody.dispose();
    _elapsed.dispose();
    _live.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ordered = [..._lines]..sort((a, b) => a.startMs.compareTo(b.startMs));
    return Scaffold(
      resizeToAvoidBottomInset: false,
      backgroundColor: Colors.white,
      body: SafeArea(
        minimum: EdgeInsets.only(bottom: inputBottomInset(context)),
        child: Column(
          children: [
            SizedBox(
              height: 44,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    _round(
                      label: '返回',
                      onTap: _back,
                      child: const Icon(Icons.arrow_back, size: 20),
                    ),
                    const Spacer(),
                    ValueListenableBuilder<Duration>(
                      valueListenable: _elapsed,
                      builder: (_, duration, _) => Row(
                        children: [
                          if (_recording)
                            Container(
                              width: 12,
                              height: 12,
                              decoration: BoxDecoration(
                                color: _blue,
                                shape: BoxShape.circle,
                                boxShadow: [
                                  BoxShadow(
                                    color: _blue.withValues(alpha: 0.18),
                                    spreadRadius: 4,
                                  ),
                                ],
                              ),
                            ),
                          if (_recording) const SizedBox(width: 10),
                          Text(
                            clockFromMs(duration.inMilliseconds),
                            style: const TextStyle(
                              fontSize: 15,
                              fontFeatures: [FontFeature.tabularFigures()],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_status != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: Text(_status!, style: const TextStyle(color: _red)),
              ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
                children: [
                  if (ordered.isEmpty)
                    Text(
                      _recording ? '正在听…' : '转写会显示在这里。',
                      style: const TextStyle(
                        fontSize: 16,
                        height: 1.6,
                        color: _sub,
                      ),
                    ),
                  for (final line in ordered)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 22),
                      child: Text(
                        line.text,
                        style: TextStyle(
                          fontSize: 16,
                          height: 1.6,
                          color: line.done ? _ink : _sub,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            if (_namingFailed)
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  TextButton(
                    onPressed: _saving ? null : _retryRecordingName,
                    child: const Text('重试 AI 命名'),
                  ),
                  TextButton(
                    onPressed: _saving
                        ? null
                        : () => Navigator.pop(context, true),
                    child: const Text('保留原标题'),
                  ),
                ],
              ),
            Padding(
              padding: const EdgeInsets.only(bottom: 20),
              child: ActionPill(
                children: [
                  PillButton(
                    dark: true,
                    icon: _recording ? Icons.stop : Icons.mic_none,
                    label: _connecting
                        ? '连接中'
                        : _finalizing
                        ? '等待转写'
                        : _saving
                        ? '保存中'
                        : _recording
                        ? '保存'
                        : '开始',
                    onPressed: _connecting || _finalizing || _saving
                        ? null
                        : _recording
                        ? _askSave
                        : _start,
                  ),
                  if (!_recording && _elapsed.value > Duration.zero)
                    PillButton(
                      icon: Icons.save_outlined,
                      label: '保存',
                      onPressed: _connecting || _finalizing || _saving
                          ? null
                          : _save,
                    ),
                  PillButton(
                    icon: Icons.edit_outlined,
                    label: '笔记',
                    onPressed: _sideNote,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SideNote extends StatefulWidget {
  const _SideNote({
    required this.api,
    required this.machine,
    required this.title,
    required this.body,
    required this.elapsed,
    required this.live,
    required this.onAi,
    required this.onPickImage,
    required this.pendingImages,
    required this.currentNoteId,
  });
  final MulticaApi api;
  final String machine;
  final TextEditingController title;
  final TextEditingController body;
  final ValueNotifier<Duration> elapsed;
  final ValueNotifier<bool> live;
  final Future<void> Function() onAi;
  final Future<PickedImage?> Function(ImageSource) onPickImage;
  final List<PickedImage> pendingImages;
  final String? Function() currentNoteId;

  @override
  State<_SideNote> createState() => _SideNoteState();
}

class _SideNoteState extends State<_SideNote> {
  final _history = UndoHistoryController();
  String? _error;
  final _images = <String, Uint8List>{};

  @override
  void initState() {
    super.initState();
    for (final image in widget.pendingImages) {
      _images[image.name] = image.bytes;
    }
    _history.addListener(_refresh);
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final image = await widget.onPickImage(source);
      if (!mounted || image == null) return;
      _images[image.name] = image.bytes;
      insertPendingMarkdownImage(widget.body, image.name);
      setState(() => _error = null);
    } catch (error) {
      if (mounted) setState(() => _error = '图片未插入，原有文字已保留。$error');
    }
  }

  @override
  void dispose() {
    _history.removeListener(_refresh);
    _history.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: false,
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: ValueListenableBuilder<bool>(
          valueListenable: widget.live,
          builder: (_, recording, _) {
            if (!recording) return const Text('笔记');
            return ValueListenableBuilder<Duration>(
              valueListenable: widget.elapsed,
              builder: (_, duration, _) => Text(
                '录音进行中 · ${clockFromMs(duration.inMilliseconds)}',
                style: const TextStyle(color: _blue, fontSize: 14),
              ),
            );
          },
        ),
        actions: [
          IconButton(
            tooltip: '撤回',
            onPressed: _history.value.canUndo ? _history.undo : null,
            icon: const Icon(Icons.undo),
          ),
          IconButton(
            tooltip: '重做',
            onPressed: _history.value.canRedo ? _history.redo : null,
            icon: const Icon(Icons.redo),
          ),
          TextButton(
            onPressed: () async {
              await _stopEditorVoice(widget.body);
              if (context.mounted) Navigator.pop(context);
            },
            child: const Text(
              '保存',
              style: TextStyle(color: _blue, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
      body: Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + inputBottomInset(context)),
        child: Column(
          children: [
            TextField(
              controller: widget.title,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
              decoration: const InputDecoration(
                hintText: '无标题',
                border: InputBorder.none,
              ),
            ),
            Expanded(
              child: _MarkdownEditor(
                controller: widget.body,
                history: _history,
                pendingImages: _images,
                mediaApi: widget.api,
                mediaMachine: widget.machine,
                mediaNoteId: widget.currentNoteId(),
                onCamera: () => _pickImage(ImageSource.camera),
                onGallery: () => _pickImage(ImageSource.gallery),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: const TextStyle(color: _red)),
              ),
          ],
        ),
      ),
    );
  }
}

final _editorVoices = <TextEditingController, VoiceInput>{};
Future<void> _stopEditorVoice(TextEditingController controller) async {
  final voice = _editorVoices[controller];
  if (voice == null) return;
  while (voice.connecting) {
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
  if (voice.active) await voice.stop();
}

class _MarkdownEditor extends StatefulWidget {
  const _MarkdownEditor({
    super.key,
    required this.controller,
    this.history,
    this.editing,
    this.onBeginEdit,
    this.autofocus = true,
    this.onCamera,
    this.onGallery,
    this.mediaApi,
    this.mediaMachine,
    this.mediaNoteId,
    this.pendingImages = const {},
  });
  final TextEditingController controller;
  final UndoHistoryController? history;
  final bool? editing;
  final VoidCallback? onBeginEdit;
  final bool autofocus;
  final VoidCallback? onCamera;
  final VoidCallback? onGallery;
  final MulticaApi? mediaApi;
  final String? mediaMachine;
  final String? mediaNoteId;
  final Map<String, Uint8List> pendingImages;

  @override
  State<_MarkdownEditor> createState() => _MarkdownEditorState();
}

class _MarkdownEditorState extends State<_MarkdownEditor> {
  UndoHistoryController? _ownedHistory;
  final _focus = FocusNode();
  var _localEditing = false;
  VoiceInput? _voice;

  bool get _isEditing => widget.editing ?? _localEditing;

  UndoHistoryController get _undo => widget.history ?? _ownedHistory!;

  @override
  void initState() {
    super.initState();
    if (widget.history == null) _ownedHistory = UndoHistoryController();
    _undo.addListener(_rebuild);
    if (widget.mediaApi != null && widget.mediaMachine != null) {
      _voice = VoiceInput(
        api: widget.mediaApi!,
        machine: widget.mediaMachine!,
        input: widget.controller,
      )..addListener(_rebuild);
      _editorVoices[widget.controller] = _voice!;
    }
  }

  @override
  void didUpdateWidget(_MarkdownEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.history != widget.history) {
      (oldWidget.history ?? _ownedHistory)?.removeListener(_rebuild);
      _undo.addListener(_rebuild);
    }
    if (widget.editing == true &&
        oldWidget.editing != true &&
        widget.autofocus) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _focus.requestFocus();
      });
    }
    if (widget.editing == false && oldWidget.editing == true) {
      _focus.unfocus();
    }
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _undo.removeListener(_rebuild);
    if (_editorVoices[widget.controller] == _voice) {
      _editorVoices.remove(widget.controller);
    }
    _voice?.removeListener(_rebuild);
    _voice?.dispose();
    _focus.dispose();
    _ownedHistory?.dispose();
    super.dispose();
  }

  void _apply(String left, String right) {
    final text = widget.controller.text;
    var selection = widget.controller.selection;
    if (!selection.isValid) {
      selection = TextSelection.collapsed(offset: text.length);
    }
    if (selection.isCollapsed) {
      final start = text.lastIndexOf('\n', selection.start - 1) + 1;
      final lineEnd = text.indexOf('\n', selection.start);
      selection = TextSelection(
        baseOffset: start,
        extentOffset: lineEnd < 0 ? text.length : lineEnd,
      );
    }
    final middle = selection.textInside(text);
    final next = text.replaceRange(
      selection.start,
      selection.end,
      '$left$middle$right',
    );
    widget.controller.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(
        offset: selection.start + left.length + middle.length,
      ),
    );
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_voice?.error != null)
          Text(_voice!.error!, style: const TextStyle(color: _red)),
        Expanded(child: _isEditing ? _field() : _preview()),
        if (_isEditing) const Divider(height: 1, color: Color(0xFFE5E5EA)),
        if (_isEditing)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                if (widget.history == null) ...[
                  _tool('撤回', _undo.value.canUndo ? _undo.undo : null),
                  _tool('重做', _undo.value.canRedo ? _undo.redo : null),
                ],
                if (_voice != null)
                  IconButton(
                    tooltip: _voice!.active ? '停止语音输入' : '语音输入',
                    onPressed: _voice!.connecting || _voice!.stopping
                        ? null
                        : () =>
                              _voice!.active ? _voice!.stop() : _voice!.start(),
                    icon: Icon(
                      _voice!.active ? Icons.stop_circle : Icons.mic_none,
                    ),
                  ),
                if (widget.onCamera != null)
                  _tool('拍照', _voice?.active == true ? null : widget.onCamera),
                if (widget.onGallery != null)
                  _tool('选图', _voice?.active == true ? null : widget.onGallery),
                _tool(
                  '标题',
                  _voice?.active == true ? null : () => _apply('# ', ''),
                ),
                _tool(
                  '加粗',
                  _voice?.active == true ? null : () => _apply('**', '**'),
                ),
                _tool(
                  '列表',
                  _voice?.active == true ? null : () => _apply('* ', ''),
                ),
                _tool(
                  '有序列表',
                  _voice?.active == true ? null : () => _apply('1. ', ''),
                ),
              ],
            ),
          ),
      ],
    );
  }

  void _beginEdit() {
    if (widget.onBeginEdit != null) {
      widget.onBeginEdit!();
      return;
    }
    if (!widget.controller.selection.isValid) {
      widget.controller.selection = TextSelection.collapsed(
        offset: widget.controller.text.length,
      );
    }
    setState(() => _localEditing = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  Widget _preview() {
    final raw = widget.controller.text.trim();
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.editing == false ? null : _beginEdit,
      child: Align(
        alignment: Alignment.topLeft,
        child: raw.isEmpty
            ? const Text('正文', style: TextStyle(color: _sub, fontSize: 16))
            : SingleChildScrollView(
                child: IMindMarkdown(
                  data: raw,
                  api: widget.mediaApi,
                  machine: widget.mediaMachine,
                  noteId: widget.mediaNoteId,
                  pendingImages: widget.pendingImages,
                ),
              ),
      ),
    );
  }

  Widget _field() {
    return TextField(
      controller: widget.controller,
      focusNode: _focus,
      undoController: _undo,
      autofocus: widget.autofocus,
      maxLines: null,
      readOnly: _voice?.active == true,
      style: const TextStyle(fontSize: 16),
      expands: true,
      textAlignVertical: TextAlignVertical.top,
      keyboardType: TextInputType.multiline,
      decoration: const InputDecoration(
        hintText: '正文',
        border: InputBorder.none,
        contentPadding: EdgeInsets.symmetric(vertical: 8),
      ),
    );
  }

  Widget _tool(String label, VoidCallback? onPressed, {Color? color}) {
    return TextButton(
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        minimumSize: const Size(0, 40),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        foregroundColor: color,
      ),
      onPressed: onPressed,
      child: Text(label),
    );
  }
}

class ChatUnreadBadge extends StatelessWidget {
  const ChatUnreadBadge({super.key, required this.count});
  final int count;

  @override
  Widget build(BuildContext context) => Container(
    width: count < 10 ? 19 : 24,
    height: count < 10 ? 19 : 24,
    padding: const EdgeInsets.all(3),
    decoration: const BoxDecoration(color: _red, shape: BoxShape.circle),
    alignment: Alignment.center,
    child: FittedBox(
      fit: BoxFit.scaleDown,
      child: Text(
        count > 99 ? '99+' : '$count',
        style: const TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}

class AiChatButton extends StatelessWidget {
  const AiChatButton({
    super.key,
    required this.noteId,
    required this.machine,
    required this.onPressed,
  });
  final String noteId;
  final String? machine;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final unread =
        ChatUnreadScope.maybeOf(context)?.unreadForNote(noteId, machine) ?? 0;
    return TextButton(
      onPressed: onPressed,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('AI+'),
          if (unread > 0) ...[
            const SizedBox(width: 5),
            ChatUnreadBadge(count: unread),
          ],
        ],
      ),
    );
  }
}

class ActionPill extends StatelessWidget {
  const ActionPill({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xEBFFFFFF),
      borderRadius: BorderRadius.circular(28),
      elevation: 8,
      shadowColor: const Color(0x1A141432),
      child: Padding(
        padding: const EdgeInsets.all(5),
        child: Row(mainAxisSize: MainAxisSize.min, children: children),
      ),
    );
  }
}

class PillButton extends StatelessWidget {
  const PillButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.dark = false,
  });
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final foreground = !enabled ? _sub : (dark ? Colors.white : _ink);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: !enabled
            ? const Color(0xFFE5E5EA)
            : dark
            ? _dark
            : Colors.transparent,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 16, 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 16, color: foreground),
                const SizedBox(width: 8),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: foreground,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Widget _round({
  required String label,
  required VoidCallback onTap,
  required Widget child,
}) {
  return Tooltip(
    message: label,
    child: Material(
      color: Colors.white,
      shape: const CircleBorder(),
      elevation: 2,
      shadowColor: const Color(0x12141432),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(width: 44, height: 44, child: Center(child: child)),
      ),
    ),
  );
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.text, this.color = _sub});
  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: color),
        const SizedBox(width: 4),
        Text(text, style: const TextStyle(fontSize: 12, color: _sub)),
      ],
    );
  }
}

List<String> noteTags(Map note) =>
    ((note['tags'] as List?) ?? const []).map((item) => '$item').toList();

String noteTypeLabel(String? type) => switch (type) {
  'recording' => '音频',
  'clip' => '剪藏',
  'note' => '笔记',
  _ => type ?? '',
};

IconData noteIcon(String? type) => switch (type) {
  'recording' => Icons.mic_none,
  'clip' => Icons.link,
  _ => Icons.notes,
};

Color noteColor(String? type) => switch (type) {
  'recording' => _blue,
  'clip' => const Color(0xFFF07B3F),
  _ => const Color(0xFFE6A23C),
};

String formatWhen(String? iso) {
  final time = DateTime.tryParse(iso ?? '')?.toLocal();
  if (time == null) return '';
  String two(int value) => value.toString().padLeft(2, '0');
  return '${time.year}-${two(time.month)}-${two(time.day)} ${two(time.hour)}:${two(time.minute)}';
}

String clockFromMs(int ms) {
  if (ms < 0) ms = 0;
  final minutes = (ms ~/ 60000).toString().padLeft(2, '0');
  final seconds = ((ms ~/ 1000) % 60).toString().padLeft(2, '0');
  return '$minutes:$seconds';
}

String? sourceHost(Object? url) {
  if (url is! String || url.isEmpty) return null;
  return Uri.tryParse(url)?.host ?? url;
}
