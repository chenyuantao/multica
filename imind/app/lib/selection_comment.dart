import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:record/record.dart';

import 'ai_composer.dart';
import 'action_button.dart';
import 'api.dart';
import 'voice_input.dart';

/// Drafts a selection instruction without sending a chat message.
class SelectionCommentSheet extends StatefulWidget {
  const SelectionCommentSheet({
    super.key,
    required this.markdown,
    this.api,
    this.machine,
    this.voiceRecorder,
    this.voiceSessionFactory,
  });
  final String markdown;
  final MulticaApi? api;
  final String? machine;
  final AudioRecorder? voiceRecorder;
  final VoiceSessionFactory? voiceSessionFactory;

  @override
  State<SelectionCommentSheet> createState() => _SelectionCommentSheetState();
}

class _SelectionCommentSheetState extends State<SelectionCommentSheet> {
  final _input = TextEditingController();
  VoiceInput? _voice;

  @override
  void initState() {
    super.initState();
    final api = widget.api;
    final machine = widget.machine;
    if (api != null && machine != null) {
      _voice = VoiceInput(
        api: api,
        machine: machine,
        input: _input,
        recorder: widget.voiceRecorder,
        sessionFactory: widget.voiceSessionFactory,
      )..addListener(_refresh);
    }
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _voice?.removeListener(_refresh);
    _voice?.dispose();
    _input.dispose();
    super.dispose();
  }

  void _submit() {
    if (_voice?.active == true) return;
    if (_input.text.trim().isNotEmpty) {
      Navigator.pop(context, _input.text.trim());
    }
  }

  @override
  Widget build(BuildContext context) {
    final voice = _voice;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Text(
                    'AI+ 划词评论',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const Spacer(),
                  TextFieldTapRegion(
                    child: AppActionButton(
                      tooltip: '取消划词评论',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ),
                ],
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF2F2F6),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  widget.markdown,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Color(0xFF6C6C70)),
                ),
              ),
              if (voice?.error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    voice!.error!,
                    style: const TextStyle(color: Color(0xFFE5484D)),
                  ),
                ),
              if (voice?.active == true)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    voice!.connecting
                        ? '正在连接语音服务…'
                        : voice.stopping
                        ? '正在完成识别…'
                        : '正在聆听，识别文字将填入输入框',
                  ),
                ),
              AiComposer(
                controller: _input,
                autofocus: true,
                onSend: voice?.active == true ? null : _submit,
                onTapOutside: () => Navigator.pop(context),
                inputFormatters: [
                  if (voice?.active == true)
                    TextInputFormatter.withFunction((oldValue, _) => oldValue),
                ],
                voiceActive: voice?.active == true,
                onVoice: voice == null || voice.connecting || voice.stopping
                    ? null
                    : () => voice.active ? voice.stop() : voice.start(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
