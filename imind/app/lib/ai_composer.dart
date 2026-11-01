import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The same input and send controls for chat messages and selection comments.
class AiComposer extends StatelessWidget {
  const AiComposer({
    super.key,
    required this.controller,
    required this.onSend,
    this.autofocus = false,
    this.onVoice,
    this.voiceActive = false,
    this.inputFormatters,
    this.onTapOutside,
  });
  final TextEditingController controller;
  final VoidCallback? onSend;
  final bool autofocus;
  final VoidCallback? onVoice;
  final bool voiceActive;
  final List<TextInputFormatter>? inputFormatters;
  final VoidCallback? onTapOutside;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: TextField(
          key: const ValueKey('ai-composer-input'),
          controller: controller,
          autofocus: autofocus,
          onTapOutside: (_) => onTapOutside != null
              ? onTapOutside!()
              : FocusManager.instance.primaryFocus?.unfocus(),
          inputFormatters: inputFormatters,
          minLines: 1,
          maxLines: 5,
          decoration: const InputDecoration(
            hintText: '告诉 AI+ 你想怎么写…',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.all(Radius.circular(24)),
              borderSide: BorderSide.none,
            ),
            filled: true,
            fillColor: Color(0xFFF2F2F6),
            contentPadding: EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          ),
          scrollPadding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
          ),
          onSubmitted: (_) => onSend?.call(),
        ),
      ),
      if (onVoice != null)
        TextFieldTapRegion(
          child: IconButton(
            tooltip: voiceActive ? '停止语音输入' : '语音输入',
            onPressed: onVoice,
            icon: Icon(
              voiceActive ? Icons.stop_circle : Icons.mic_none,
              color: voiceActive
                  ? const Color(0xFFE5484D)
                  : const Color(0xFF8E8E93),
            ),
          ),
        ),
      const SizedBox(width: 8),
      TextFieldTapRegion(
        child: IconButton.filled(
          tooltip: '发送',
          onPressed: onSend,
          icon: const Icon(Icons.arrow_upward),
        ),
      ),
    ],
  );
}
