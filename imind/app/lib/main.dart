import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:record/record.dart';

import 'api.dart';
import 'asr_session.dart';
import 'transcript.dart';
import 'url_extract.dart';

const _storage = FlutterSecureStorage();
const _machineKey = 'imind_share_machine';

const _bg = Color(0xFFF2F2F6);
const _ink = Color(0xFF1C1C1E);
const _sub = Color(0xFF8E8E93);
const _blue = Color(0xFF3478F6);
const _dark = Color(0xFF23262C);
const _line = Color(0xFFE2E2E7);
const _red = Color(0xFFE5484D);

void main() => runApp(const IMindApp());

class IMindApp extends StatelessWidget {
  const IMindApp({super.key, this.initialToken});

  /// Empty string forces the login screen. Null reads the persisted token.
  final String? initialToken;

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
      home: SessionGate(initialToken: initialToken),
    );
  }
}

class SessionGate extends StatefulWidget {
  const SessionGate({super.key, this.initialToken});
  final String? initialToken;

  @override
  State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> {
  String? _token;
  var _ready = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialToken != null) {
      _token = widget.initialToken!.isEmpty ? null : widget.initialToken;
      _ready = true;
      return;
    }
    _storage
        .read(key: 'multica_token')
        .then((value) {
          if (!mounted) return;
          setState(() {
            _token = value;
            _ready = true;
          });
        })
        .catchError((_) {
          if (mounted) setState(() => _ready = true);
        });
  }

  Future<void> _login(String token) async {
    await _storage.write(key: 'multica_token', value: token);
    if (mounted) setState(() => _token = token);
  }

  Future<void> _logout() async {
    await _storage.delete(key: 'multica_token');
    if (mounted) setState(() => _token = null);
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_token == null) return LoginPage(onLogin: _login);
    return HomePage(token: _token!, onLogout: _logout);
  }
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.onLogin});
  final Future<void> Function(String token) onLogin;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _api = MulticaApi(baseUrl: defaultApiBase());
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
        setState(() => _sent = true);
      } else {
        final token = await _api.verifyCode(
          _email.text.trim(),
          _code.text.trim(),
        );
        await widget.onLogin(token);
      }
    } catch (error) {
      setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(_error!, style: const TextStyle(color: _red)),
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
  const HomePage({super.key, required this.token, required this.onLogout});
  final String token;
  final Future<void> Function() onLogout;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _scaffold = GlobalKey<ScaffoldState>();
  late final _api = MulticaApi(baseUrl: defaultApiBase())..token = widget.token;
  List<Map<String, dynamic>> _notes = const [];
  String? _machine;
  String? _error;
  String? _kind;
  String? _tag;
  var _ready = false;
  var _newestFirst = true;
  var _selecting = false;
  var _menu = false;
  final _selected = <String>{};

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    try {
      final shares = await _api.shares();
      if (shares.isEmpty) {
        if (!mounted) return;
        setState(() {
          _ready = true;
          _machine = null;
          _error = '当前工作区还没有已连接的共享知识库';
        });
        return;
      }
      final names = [
        for (final share in shares)
          if (share['machine'] is String) share['machine'] as String,
      ];
      final saved = await _storage.read(key: _machineKey);
      final machine = saved != null && names.contains(saved)
          ? saved
          : names.first;
      await _storage.write(key: _machineKey, value: machine);
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
      if (error.status == 401) {
        await widget.onLogout();
        return;
      }
      if (!mounted) return;
      setState(() {
        _ready = true;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _ready = true;
        _error = '$error';
      });
    }
  }

  List<Map<String, dynamic>> get _visible {
    final items = _notes.where((note) {
      if (_kind != null && note['type'] != _kind) return false;
      if (_tag != null && !noteTags(note).contains(_tag)) return false;
      return true;
    }).toList();
    if (!_newestFirst) return items.reversed.toList();
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
    if (_tag != null) return '# $_tag';
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
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => NoteEditor(api: _api, machine: _machine),
      ),
    );
    if (saved == true) _reload();
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
    var error = '';
    final url = await showModalBottomSheet<String>(
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
                bottom: 24 + MediaQuery.viewInsetsOf(context).bottom,
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
                    '粘贴链接，只保存识别出的网址，不抓取网页。',
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
                        Navigator.pop(context, found);
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
    if (url == null || _machine == null) return;
    await _api.createNote({
      'share_machine': _machine,
      'type': 'clip',
      'title': '网页剪藏',
      'source_url': url,
      'content': '# 网页剪藏\n\n$url',
    });
    _reload();
  }

  List<Map<String, dynamic>> get _chosen =>
      _notes.where((note) => _selected.contains('${note['id']}')).toList();

  Future<void> _patchChosen(
    Map<String, dynamic> Function(Map<String, dynamic> note) patch,
  ) async {
    final machine = _machine;
    if (machine == null) return;
    for (final note in _chosen) {
      final next = patch(note);
      await _api.updateNote('${note['id']}', {
        'share_machine': machine,
        'revision': note['revision'],
        'title': next['title'] ?? note['title'],
        'tags': next['tags'] ?? noteTags(note),
        'content': next['content'] ?? note['content'] ?? '',
        'transcript': next['transcript'] ?? note['transcript'] ?? '',
      });
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
    final controller = TextEditingController();
    final tag = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('标记'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final item in _allTags)
              ListTile(
                title: Text('#$item'),
                onTap: () => Navigator.pop(context, item),
              ),
            TextField(
              controller: controller,
              decoration: const InputDecoration(hintText: '新建标签'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('使用新标签'),
          ),
        ],
      ),
    );
    Future<void>.delayed(const Duration(milliseconds: 350), controller.dispose);
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

  Future<void> _mockName() async {
    await _patchChosen((note) {
      final title = '${note['title'] ?? ''}'.trim();
      if (title.startsWith('（Mock）')) return {'title': title};
      return {'title': title.isEmpty ? '（Mock）未命名' : '（Mock）$title'};
    });
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
    for (final note in chosen) {
      await _api.deleteNote('${note['id']}', machine, '${note['revision']}');
    }
    if (mounted) {
      setState(() {
        _selecting = false;
        _selected.clear();
      });
    }
    await _reload();
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
        _tag == null;
    return Scaffold(
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
                if (_tag != null || _kind != null)
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
            const Spacer(),
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
    if (_error != null && _notes.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(_error!, textAlign: TextAlign.center),
        ),
      );
    }
    if (showHero) return const _EmptyHero();
    if (visible.isEmpty) {
      return const Center(
        child: Text('没有文件', style: TextStyle(color: _sub)),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 120),
      itemCount: visible.length,
      itemBuilder: (_, index) => _tile(visible[index]),
    );
  }

  Widget _tile(Map<String, dynamic> note) {
    final id = '${note['id']}';
    final type = note['type'] as String?;
    final audio = note['audio'];
    final duration = audio is Map ? audio['duration_ms'] : null;
    final host = sourceHost(note['source_url']);
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
              _bar('导出', Icons.ios_share, null),
              _bar(
                'AI 命名',
                Icons.auto_fix_high,
                _selected.isEmpty ? null : _mockName,
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
                          _menuItem(Icons.swap_vert, '排序方式', () {
                            setState(() => _newestFirst = !_newestFirst);
                          }),
                          _menuItem(Icons.link, '网页剪藏', _clip),
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
                  onTap: widget.onLogout,
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
              _kind == null && _tag == null,
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
              _nav('#$tag', Icons.tag, _ink, _tag == tag, () => _pickTag(tag)),
          ],
        ),
      ),
    );
  }

  void _pickKind(String? kind) {
    setState(() {
      _kind = kind;
      _tag = null;
      _selecting = false;
      _selected.clear();
    });
    Navigator.pop(context);
  }

  void _pickTag(String tag) {
    setState(() {
      _tag = tag;
      _kind = null;
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

class NoteEditor extends StatefulWidget {
  const NoteEditor({
    super.key,
    required this.api,
    required this.machine,
    this.note,
    this.showTranscript = true,
    this.focusTranscript = false,
  });
  final MulticaApi api;
  final String? machine;
  final Map<String, dynamic>? note;
  final bool showTranscript;
  final bool focusTranscript;

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
  var _menu = false;
  var _editing = false;
  var _focusTitle = false;
  var _changed = false;
  var _saving = false;
  var _popping = false;
  String? _error;
  late String _titleSnapshot;
  late String _bodySnapshot;
  late String _transcriptSnapshot;
  late List<String> _tagSnapshot;

  @override
  void initState() {
    super.initState();
    _note = widget.note == null ? null : Map<String, dynamic>.from(widget.note!);
    _history.addListener(_refresh);
    _body.addListener(_refresh);
    _transcript.addListener(_refresh);
    _capture();
  }

  void _capture() {
    _titleSnapshot = _title.text;
    _bodySnapshot = _body.text;
    _transcriptSnapshot = _transcript.text;
    _tagSnapshot = List<String>.of(_tags);
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
    _capture();
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

  void _discard() {
    _title.text = _titleSnapshot;
    _body.text = _bodySnapshot;
    _transcript.text = _transcriptSnapshot;
    _tags
      ..clear()
      ..addAll(_tagSnapshot);
    setState(() => _editing = false);
    FocusManager.instance.primaryFocus?.unfocus();
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
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
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

  Future<void> _pickTag() async {
    final controller = TextEditingController();
    final tag = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('标签'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: '新建标签'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('添加'),
          ),
        ],
      ),
    );
    Future<void>.delayed(const Duration(milliseconds: 350), controller.dispose);
    final name = tag?.trim() ?? '';
    if (!mounted || name.isEmpty || _tags.contains(name)) return;
    setState(() => _tags.add(name));
  }

  String get _activeText =>
      widget.focusTranscript ? _transcript.text : _body.text;

  Widget _editor(TextEditingController controller) {
    return _MarkdownEditor(
      controller: controller,
      history: _history,
      editing: _editing,
      onBeginEdit: () => _beginEdit(),
      autofocus: !_focusTitle,
      onAi: _ai,
      onTag: _pickTag,
    );
  }

  void _ai() {
    final name = _title.text.trim().isEmpty ? '未命名' : _title.text.trim();
    showAiSheet(
      context,
      title: 'AI+ 写作',
      subtitle: '基于当前笔记「$name」',
      opening: '想怎么调整这篇笔记？直接告诉我，我会结合全文帮你完成。',
    );
  }

  @override
  Widget build(BuildContext context) {
    final source = widget.note?['source_url'];
    return PopScope(
      canPop: _popping,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop || _popping) return;
        if (_editing) {
          _discard();
          return;
        }
        _leave();
      },
      child: Scaffold(
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
          ] else if (_note != null)
            IconButton(
              tooltip: '更多',
              onPressed: () => setState(() => _menu = true),
              icon: const Icon(Icons.more_horiz),
            ),
        ],
      ),
      body: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              children: [
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
                if (_tags.isNotEmpty || _activeText.trim().isNotEmpty)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      [
                        for (final tag in _tags) '#$tag',
                        if (_activeText.trim().isNotEmpty)
                          '${_activeText.trim().length} 字',
                      ].join('  '),
                      style: const TextStyle(color: _sub, fontSize: 12),
                    ),
                  ),
                if (source is String && source.isNotEmpty)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      source,
                      style: const TextStyle(color: _sub, fontSize: 12),
                    ),
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
                      child: _MarkdownEditor(
                        controller: _transcript,
                        onTag: _pickTag,
                      ),
                    ),
                  ],
                ],
              ],
            ),
          ),
          if (_menu) _noteMenu(),
        ],
      ),
      ),
    );
  }

  Widget _noteMenu() {
    return Positioned.fill(
      child: GestureDetector(
        onTap: () => setState(() => _menu = false),
        child: ColoredBox(
          color: const Color(0x0F000000),
          child: SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: Padding(
                padding: const EdgeInsets.only(top: 8, right: 12),
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
                          Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 22,
                              vertical: 14,
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.ios_share,
                                  size: 22,
                                  color: _sub,
                                ),
                                const SizedBox(width: 16),
                                const Text(
                                  '导出',
                                  style: TextStyle(fontSize: 17, color: _sub),
                                ),
                                const Spacer(),
                                Text(
                                  '暂不可用',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: _sub.withValues(alpha: 0.9),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          _editorMenuItem(Icons.edit_outlined, '重命名', _rename),
                          _editorMenuItem(
                            Icons.delete_outline,
                            '删除',
                            _confirmDelete,
                            color: _red,
                          ),
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

  Widget _editorMenuItem(
    IconData icon,
    String label,
    VoidCallback onTap, {
    Color? color,
  }) {
    return InkWell(
      onTap: () {
        setState(() => _menu = false);
        onTap();
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        child: Row(
          children: [
            Icon(icon, size: 22, color: color ?? const Color(0xFF3A3A3C)),
            const SizedBox(width: 16),
            Text(
              label,
              style: TextStyle(fontSize: 17, color: color),
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
  });
  final MulticaApi api;
  final String machine;
  final Map<String, dynamic> note;

  @override
  State<RecordingDetail> createState() => _RecordingDetailState();
}

class _RecordingDetailState extends State<RecordingDetail> {
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
  var _popping = false;
  String? _error;
  late String _contentSnapshot;
  late String _transcriptSnapshot;

  @override
  void initState() {
    super.initState();
    _contentHistory.addListener(_rebuild);
    _transcriptHistory.addListener(_rebuild);
    _capture();
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
    super.dispose();
  }

  void _capture() {
    _contentSnapshot = _content.text;
    _transcriptSnapshot = _transcriptText.text;
  }

  UndoHistoryController get _activeHistory =>
      _tab == 0 ? _transcriptHistory : _contentHistory;

  void _beginEdit() {
    if (_editing) return;
    _capture();
    setState(() {
      _editing = true;
      _error = null;
    });
  }

  void _discard() {
    _content.text = _contentSnapshot;
    _transcriptText.text = _transcriptSnapshot;
    _closeEdit();
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

  void _ai() {
    showAiSheet(
      context,
      title: 'AI+ 写作',
      subtitle: '基于「${_note['title']}」',
      opening: '可以追问这段录音，或让我整理成笔记。',
    );
  }

  @override
  Widget build(BuildContext context) {
    final lines = parseTranscript('${_note['transcript'] ?? ''}');
    final tags = noteTags(_note);
    return PopScope(
      canPop: _popping,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop || _popping) return;
        if (_editing) {
          _discard();
          return;
        }
        _leave();
      },
      child: Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
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
                    const Spacer(),
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
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
              child: Text(
                '${_note['title'] ?? ''}',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  height: 1.4,
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
            if (!_editing && (tags.isNotEmpty || _note['updated_at'] != null))
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Text(
                  [
                    ...tags,
                    formatWhen(_note['updated_at'] as String?),
                  ].where((item) => item.isNotEmpty).join(' · '),
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFFA0A0A5),
                  ),
                ),
              ),
            if (!_editing)
              Padding(
              padding: const EdgeInsets.only(bottom: 20),
              child: Center(
                child: ActionPill(
                  children: [
                    const PillButton(
                      dark: true,
                      icon: Icons.play_arrow,
                      label: '播放',
                      onPressed: null,
                    ),
                    PillButton(
                      icon: Icons.auto_awesome,
                      label: 'AI+',
                      onPressed: () => showAiSheet(
                        context,
                        title: 'AI+ 问答',
                        subtitle: '基于「${_note['title']}」',
                        opening: '可以追问这段录音，或让我整理成笔记。',
                      ),
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
      onTap: () => setState(() => _tab = index),
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
    return _MarkdownEditor(
      key: ValueKey(transcript ? 'transcript' : 'content'),
      controller: transcript ? _transcriptText : _content,
      history: transcript ? _transcriptHistory : _contentHistory,
      editing: true,
      onAi: _ai,
    );
  }

  Widget _transcript(List<TranscriptSegment> lines) {
    if (lines.isEmpty) {
      final raw = '${_note['transcript'] ?? ''}'.trim();
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _beginEdit,
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
              onTap: _beginEdit,
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
      onTap: _beginEdit,
      child: Align(
        alignment: Alignment.topLeft,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: content.isEmpty
              ? const Text(
                  '还没有笔记',
                  style: TextStyle(color: _sub, fontSize: 16),
                )
              : MarkdownBody(data: content),
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
  });
  final AudioRecorder? recorder;
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
        channel.sendAudio,
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
    if (_saving) return;
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
      await widget.api.createNote({
        'share_machine': widget.machine,
        'type': 'recording',
        'title': title,
        'content': _noteBody.text.trim().isEmpty ? '# 录音笔记' : _noteBody.text,
        'transcript': transcript,
        'audio': {
          'duration_ms': _elapsed.value.inMilliseconds,
          'format': 'pcm_s16le',
          'sample_rate_hz': 16000,
        },
      });
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _status = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _sideNote() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _SideNote(
          title: _noteTitle,
          body: _noteBody,
          elapsed: _elapsed,
          live: _live,
        ),
      ),
    );
  }

  Future<void> _back() async {
    if (_connecting || _saving || _finalizing) return;
    if (_recording) {
      await _askSave();
      return;
    }
    if (_lines.isNotEmpty || _noteBody.text.isNotEmpty) {
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
      backgroundColor: Colors.white,
      body: SafeArea(
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
    required this.title,
    required this.body,
    required this.elapsed,
    required this.live,
  });
  final TextEditingController title;
  final TextEditingController body;
  final ValueNotifier<Duration> elapsed;
  final ValueNotifier<bool> live;

  @override
  State<_SideNote> createState() => _SideNoteState();
}

class _SideNoteState extends State<_SideNote> {
  final _history = UndoHistoryController();

  @override
  void initState() {
    super.initState();
    _history.addListener(_refresh);
  }

  void _refresh() {
    if (mounted) setState(() {});
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
            onPressed: () => Navigator.pop(context),
            child: const Text(
              '保存',
              style: TextStyle(color: _blue, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
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
                onAi: () => showAiSheet(
                  context,
                  title: 'AI+ 写作',
                  subtitle: '基于当前笔记',
                  opening: '想怎么调整这篇笔记？直接告诉我。',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MarkdownEditor extends StatefulWidget {
  const _MarkdownEditor({
    super.key,
    required this.controller,
    this.history,
    this.editing,
    this.onBeginEdit,
    this.autofocus = true,
    this.onAi,
    this.onTag,
  });
  final TextEditingController controller;
  final UndoHistoryController? history;
  final bool? editing;
  final VoidCallback? onBeginEdit;
  final bool autofocus;
  final VoidCallback? onAi;
  final VoidCallback? onTag;

  @override
  State<_MarkdownEditor> createState() => _MarkdownEditorState();
}

class _MarkdownEditorState extends State<_MarkdownEditor> {
  UndoHistoryController? _ownedHistory;
  final _focus = FocusNode();
  var _localEditing = false;

  bool get _isEditing => widget.editing ?? _localEditing;

  UndoHistoryController get _undo => widget.history ?? _ownedHistory!;

  @override
  void initState() {
    super.initState();
    if (widget.history == null) _ownedHistory = UndoHistoryController();
    _undo.addListener(_rebuild);
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
                if (widget.onAi != null)
                  _tool('AI+', widget.onAi, color: const Color(0xFF6E56CF)),
                if (widget.onTag != null) _tool('标签', widget.onTag),
                _tool('标题', () => _apply('# ', '')),
                _tool('加粗', () => _apply('**', '**')),
                _tool('列表', () => _apply('* ', '')),
                _tool('有序列表', () => _apply('1. ', '')),
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
    setState(() => _localEditing = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  Widget _preview() {
    final raw = widget.controller.text.trim();
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _beginEdit,
      child: Align(
        alignment: Alignment.topLeft,
        child: raw.isEmpty
            ? const Text('正文', style: TextStyle(color: _sub, fontSize: 16))
            : MarkdownBody(data: raw),
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

void showAiSheet(
  BuildContext context, {
  required String title,
  required String subtitle,
  String? opening,
}) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
    ),
    builder: (context) =>
        _AiSheet(title: title, subtitle: subtitle, opening: opening),
  );
}

class _AiSheet extends StatefulWidget {
  const _AiSheet({required this.title, required this.subtitle, this.opening});
  final String title;
  final String subtitle;
  final String? opening;

  @override
  State<_AiSheet> createState() => _AiSheetState();
}

class _AiMessage {
  _AiMessage(this.mine, this.text);
  final bool mine;
  final String text;
}

class _AiSheetState extends State<_AiSheet> {
  final _input = TextEditingController();
  late final _messages = <_AiMessage>[
    if (widget.opening != null) _AiMessage(false, widget.opening!),
  ];

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _send() {
    final ask = _input.text.trim();
    if (ask.isEmpty) return;
    setState(() {
      _messages.add(_AiMessage(true, ask));
      _messages.add(_AiMessage(false, '（Mock）已收到：$ask。正式模型接口尚未接入。'));
      _input.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.72,
        child: Column(
          children: [
            const SizedBox(height: 8),
            const SizedBox(
              width: 38,
              height: 5,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Color(0xFFD8D8DD),
                  borderRadius: BorderRadius.all(Radius.circular(3)),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 12, 0),
              child: Row(
                children: [
                  const Icon(
                    Icons.auto_awesome,
                    color: Color(0xFF6E56CF),
                    size: 22,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    widget.title,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: '关闭',
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close, size: 18),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  widget.subtitle,
                  style: const TextStyle(color: _sub),
                ),
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                children: [
                  for (final message in _messages)
                    Align(
                      alignment: message.mine
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 290),
                        margin: const EdgeInsets.only(bottom: 14),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 11,
                        ),
                        decoration: BoxDecoration(
                          color: message.mine ? _dark : _bg,
                          borderRadius: BorderRadius.only(
                            topLeft: const Radius.circular(18),
                            topRight: const Radius.circular(18),
                            bottomLeft: Radius.circular(message.mine ? 18 : 6),
                            bottomRight: Radius.circular(message.mine ? 6 : 18),
                          ),
                        ),
                        child: Text(
                          message.text,
                          style: TextStyle(
                            fontSize: 15,
                            height: 1.6,
                            color: message.mine ? Colors.white : _ink,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      decoration: const InputDecoration(
                        hintText: '告诉 AI+ 你想怎么写…',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.all(Radius.circular(24)),
                          borderSide: BorderSide.none,
                        ),
                        filled: true,
                        fillColor: _bg,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 18,
                          vertical: 12,
                        ),
                      ),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    tooltip: '发送',
                    onPressed: _send,
                    icon: const Icon(Icons.send, size: 18),
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
