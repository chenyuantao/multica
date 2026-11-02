import 'package:flutter/material.dart';

/// Shared icon-only action used by page headers and editing controls.
class AppActionButton extends StatelessWidget {
  const AppActionButton({
    super.key,
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final Widget icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) =>
      AppRoundControl(label: tooltip, onPressed: onPressed, child: icon);
}

class AppRoundControl extends StatelessWidget {
  const AppRoundControl({
    super.key,
    required this.label,
    required this.child,
    required this.onPressed,
  });

  final String label;
  final Widget child;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(2),
    child: IconButton(
      tooltip: label,
      onPressed: onPressed,
      style: appActionButtonStyle(),
      icon: child,
    ),
  );
}

ButtonStyle appActionButtonStyle() => IconButton.styleFrom(
  backgroundColor: Colors.white,
  disabledBackgroundColor: Colors.white,
  foregroundColor: const Color(0xFF1C1C1E),
  disabledForegroundColor: const Color(0xFF8E8E93),
  fixedSize: const Size(44, 44),
  minimumSize: const Size(44, 44),
  padding: EdgeInsets.zero,
  shape: const CircleBorder(),
  elevation: 2,
  shadowColor: const Color(0x12141432),
  iconSize: 22,
);
