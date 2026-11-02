import 'package:flutter/material.dart';

import 'note_actions.dart';
import 'action_button.dart';

const homeBackground = Color(0xFFF2F2F6);
const homeInk = Color(0xFF1C1C1E);
const homeSecondary = Color(0xFF8E8E93);
const homeLine = Color(0xFFE2E2E7);

class HomeHeader extends StatelessWidget {
  const HomeHeader({
    super.key,
    required this.title,
    required this.leadingLabel,
    required this.onLeadingPressed,
    this.trailing,
  });

  final String title;
  final String leadingLabel;
  final VoidCallback onLeadingPressed;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 54,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          HomeRoundButton(
            label: leadingLabel,
            onTap: onLeadingPressed,
            child: const Icon(Icons.menu, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(child: DetailTitle(title)),
          ?trailing,
        ],
      ),
    ),
  );
}

class HomeRoundButton extends StatelessWidget {
  const HomeRoundButton({
    super.key,
    required this.label,
    required this.onTap,
    required this.child,
  });

  final String label;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) =>
      AppRoundControl(label: label, onPressed: onTap, child: child);
}

class AppDrawerHeading extends StatelessWidget {
  const AppDrawerHeading(this.title, {super.key});

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
    child: Text(
      title,
      style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800),
    ),
  );
}
