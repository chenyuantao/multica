import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import 'api.dart';

bool isActiveNoteRun(Map<String, dynamic> run) => const {
  'queued',
  'dispatched',
  'waiting_local_directory',
  'deferred',
  'running',
}.contains(run['status']);

/// A separate navigation level for one agent message's execution transcript.
class NoteRunProgressPage extends StatefulWidget {
  const NoteRunProgressPage({
    super.key,
    required this.api,
    required this.issueId,
    required this.initialRun,
  });
  final MulticaApi api;
  final String issueId;
  final Map<String, dynamic> initialRun;

  @override
  State<NoteRunProgressPage> createState() => _NoteRunProgressPageState();
}

class _NoteRunProgressPageState extends State<NoteRunProgressPage> {
  late Map<String, dynamic> _run;
  List<Map<String, dynamic>> _messages = [];
  final Set<num> _expandedEntries = {};
  Timer? _poll;
  bool _loading = true;
  bool _stopping = false;
  String? _error;
  String? _confirmedTerminalStatus;
  String get _taskId =>
      '${widget.initialRun['id'] ?? widget.initialRun['task_id']}';

  @override
  void initState() {
    super.initState();
    _run = widget.initialRun;
    unawaited(_refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    _poll?.cancel();
    try {
      // Keep authorization and the issue-scoped run identity on every refresh.
      final runs = await widget.api.noteChatRuns(widget.issueId);
      final current = runs.where((run) => run['id'] == _taskId).firstOrNull;
      if (current == null) throw ApiException(404, '找不到此运行');
      final messages = await widget.api.noteChatRunMessages(_taskId);
      if (!mounted) return;
      setState(() {
        _run = {
          ...current,
          'agent_name':
              current['agent_name'] ??
              _run['agent_name'] ??
              widget.initialRun['agent_name'] ??
              'Agent',
          if (_confirmedTerminalStatus != null)
            'status': _confirmedTerminalStatus,
        };
        _messages = messages;
        _loading = false;
        _error = null;
        if (!isActiveNoteRun(_run)) _stopping = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '无法读取执行过程：$error';
      });
    }
    if (mounted && isActiveNoteRun(_run)) {
      _poll = Timer(const Duration(seconds: 2), () => unawaited(_refresh()));
    }
  }

  Future<void> _cancel() async {
    if (_stopping || !isActiveNoteRun(_run)) return;
    setState(() {
      _stopping = true;
      _error = null;
    });
    try {
      final result = await widget.api.cancelNoteChatRun(
        widget.issueId,
        _taskId,
      );
      if (!mounted) return;
      if (const {
        'completed',
        'failed',
        'cancelled',
      }.contains(result['status'])) {
        setState(() {
          _confirmedTerminalStatus = result['status'] as String;
          _run = {..._run, 'status': _confirmedTerminalStatus};
          _stopping = false;
        });
      }
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _stopping = false;
        _error = '无法终止运行：$error';
      });
    }
  }

  String _status() => switch (_run['status']) {
    'queued' => '排队中',
    'dispatched' => '等待 Agent',
    'waiting_local_directory' => '等待本地目录',
    'deferred' => '等待处理',
    'running' => '正在处理',
    'completed' => '已完成',
    'cancelled' => '已取消',
    'failed' => '运行失败',
    _ => '未知状态',
  };

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('执行过程')),
    body: SafeArea(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${_run['agent_name'] ?? 'Agent'} · ${_status()}',
                  ),
                ),
                if (isActiveNoteRun(_run))
                  TextButton.icon(
                    style: TextButton.styleFrom(
                      foregroundColor: const Color(0xFFE5484D),
                    ),
                    onPressed: _stopping ? null : _cancel,
                    icon: Icon(
                      _stopping ? Icons.hourglass_top : Icons.stop_circle,
                    ),
                    label: Text(_stopping ? '正在终止' : '终止'),
                  ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(child: Text(_error!)),
                  TextButton(onPressed: _refresh, child: const Text('重试')),
                ],
              ),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                ? const Center(child: Text('暂无执行过程'))
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (_, index) => _entry(_messages[index]),
                  ),
          ),
        ],
      ),
    ),
  );

  Widget _entry(Map<String, dynamic> message) {
    final type = message['type'];
    final label = switch (type) {
      'thinking' => '思考',
      'tool_use' => '调用工具：${message['tool'] ?? '工具'}',
      'tool_result' => '工具结果：${message['tool'] ?? '工具'}',
      'error' => '错误',
      _ => '回复',
    };
    final input = message['input'];
    final text =
        '${message['content'] ?? message['output'] ?? (input == null ? '' : const JsonEncoder.withIndent('  ').convert(input))}';
    return ExpansionTile(
      key: ValueKey('run-entry-$_taskId-${message['seq']}'),
      initiallyExpanded: _expandedEntries.contains(message['seq']),
      onExpansionChanged: (expanded) {
        final seq = message['seq'] as num;
        if (expanded) {
          _expandedEntries.add(seq);
        } else {
          _expandedEntries.remove(seq);
        }
      },
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.fromLTRB(16, 4, 0, 20),
      expandedCrossAxisAlignment: CrossAxisAlignment.start,
      shape: const Border(),
      collapsedShape: const Border(),
      controlAffinity: ListTileControlAffinity.leading,
      title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: text.isEmpty
          ? null
          : Text(
              text.replaceAll(RegExp(r'\s+'), ' '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
      children: [
        SizedBox(
          key: ValueKey('run-entry-body-${message['seq']}'),
          width: double.infinity,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (type == 'tool_use' || type == 'tool_result')
                SelectableText(text)
              else
                MarkdownBody(data: text, selectable: true),
              if (type == 'tool_result' && message['output_truncated'] == true)
                const Text('工具输出已截断'),
            ],
          ),
        ),
      ],
    );
  }
}
