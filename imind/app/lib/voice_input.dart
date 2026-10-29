import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:record/record.dart';

import 'api.dart';
import 'asr_session.dart';

typedef VoiceSessionFactory = AsrSession Function(
  void Function(Map<String, dynamic>) onMessage,
);

/// Dictates into a fixed selection; interim revisions replace their sentence.
class VoiceInput extends ChangeNotifier {
  VoiceInput({
    required this.api,
    required this.machine,
    required this.input,
    this.recorder,
    VoiceSessionFactory? sessionFactory,
  }) : _factory = sessionFactory;
  final MulticaApi api;
  final String machine;
  final TextEditingController input;
  final AudioRecorder? recorder;
  AudioRecorder? _recorder;
  AudioRecorder get _microphone => _recorder ??= recorder ?? AudioRecorder();
  final VoiceSessionFactory? _factory;
  AsrSession? _session;
  StreamSubscription<Uint8List>? _audio;
  final _sentences = <int, String>{};
  final _final = <int>{};
  String _before = '', _after = '';
  bool _disposed = false, _capturing = false;
  bool active = false, connecting = false, stopping = false;
  String? error;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> start() async {
    if (active || _disposed) return;
    active = connecting = true;
    error = null;
    _sentences.clear();
    _final.clear();
    final selection = input.selection;
    final start = selection.isValid
        ? selection.start.clamp(0, input.text.length)
        : input.text.length;
    final end = selection.isValid
        ? selection.end.clamp(start, input.text.length)
        : start;
    _before = input.text.substring(0, start);
    _after = input.text.substring(end);
    _notify();
    try {
      if (!await _microphone.hasPermission()) {
        throw ApiException(0, '需要麦克风权限才能语音输入');
      }
      if (_disposed) return;
      final shares = await api.shares();
      if (_disposed) return;
      if (!shares.any((s) => s['machine'] == machine)) {
        throw ApiException(403, '共享知识库不可用，请重新选择');
      }
      _session =
          _factory?.call(_receive) ??
          AsrSession.connect(api: api, machine: machine, onMessage: _receive);
      await _session!.start();
      if (_disposed || error != null) return;
      final stream = await _microphone.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: 16000,
          numChannels: 1,
        ),
      );
      _capturing = true;
      if (_disposed || error != null) {
        await _cleanup();
        return;
      }
      _audio = stream.listen(
        (bytes) => _session?.sendAudio(bytes),
        onError: (Object _) {
          unawaited(_failed('麦克风采集失败，已识别文字已保留'));
        },
        onDone: () {
          if (active && !stopping && !connecting) unawaited(stop());
        },
      );
    } catch (failure) {
      if (!_disposed) {
        error = failure is ApiException ? '$failure' : '语音输入失败，请检查麦克风权限后重试';
      }
      await _cleanup();
      active = false;
    } finally {
      connecting = false;
      if (error != null) active = false;
      _notify();
    }
  }

  void _receive(Map<String, dynamic> event) {
    if (_disposed || !active || error != null) return;
    if (event['type'] == 'error') {
      unawaited(_failed('语音识别中断，已识别文字已保留，可重试'));
      return;
    }
    if (event['type'] != 'partial' && event['type'] != 'final') return;
    final id = event['sentence_id'] as int;
    if (_final.contains(id)) return;
    _sentences[id] = event['text'] as String;
    if (event['type'] == 'final') _final.add(id);
    final text = _sentences.values.where((s) => s.isNotEmpty).join(' ');
    if (text.isEmpty) return;
    input.value = TextEditingValue(
      text: '$_before$text$_after',
      selection: TextSelection.collapsed(offset: _before.length + text.length),
    );
  }

  Future<void> _failed(String message) async {
    if (_disposed || error != null) return;
    error = message;
    _notify();
    await _cleanup();
    active = connecting = stopping = false;
    _notify();
  }

  Future<void> stop() async {
    if (!active || connecting || stopping || _disposed) return;
    stopping = true;
    _notify();
    try {
      // Stop capture first, then drain the server's final/done messages.
      if (_capturing) {
        await _recorder?.stop();
        _capturing = false;
      }
      await _audio?.cancel();
      _audio = null;
      await _session?.finish();
    } catch (_) {
      if (!_disposed) error ??= '等待最终识别失败，已识别文字已保留，可重试';
    } finally {
      await _cleanup();
      active = stopping = false;
      _notify();
    }
  }

  Future<void> _cleanup() async {
    await _audio?.cancel();
    _audio = null;
    if (_capturing) {
      _capturing = false;
      try {
        await _recorder?.stop();
      } catch (_) {}
    }
    final session = _session;
    _session = null;
    try {
      await session?.close();
    } catch (_) {}
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(
      _cleanup().whenComplete(() async {
        try {
          await (_recorder ?? recorder)?.dispose();
        } catch (_) {}
      }),
    );
    super.dispose();
  }
}
