import 'dart:math' show max;

import 'package:flutter/widgets.dart';

/// Keeps bottom inputs above either the keyboard or the home indicator.
double inputBottomInset(BuildContext context) => max(
  MediaQuery.viewInsetsOf(context).bottom,
  MediaQuery.viewPaddingOf(context).bottom,
);
