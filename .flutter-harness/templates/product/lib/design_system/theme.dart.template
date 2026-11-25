import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

/// Semantic roles resolve with the active theme, including dark mode.
abstract final class AppColors {
  static Color primary(BuildContext context) =>
      m.Theme.of(context).colorScheme.primary;
  static Color background(BuildContext context) =>
      m.Theme.of(context).colorScheme.surface;
  static Color surface(BuildContext context) =>
      m.Theme.of(context).colorScheme.surfaceContainerLow;
  static Color text(BuildContext context) =>
      m.Theme.of(context).colorScheme.onSurface;
  static Color muted(BuildContext context) =>
      m.Theme.of(context).colorScheme.onSurfaceVariant;
  static Color error(BuildContext context) =>
      m.Theme.of(context).colorScheme.error;
  static Color divider(BuildContext context) =>
      m.Theme.of(context).colorScheme.outlineVariant;
}

abstract final class AppTextStyles {
  static TextStyle body(BuildContext context) =>
      m.Theme.of(context).textTheme.bodyMedium ??
      DefaultTextStyle.of(context).style;

  static TextStyle heading(BuildContext context) =>
      m.Theme.of(context).textTheme.titleLarge ??
      DefaultTextStyle.of(context).style;

  static TextStyle caption(BuildContext context) =>
      (m.Theme.of(context).textTheme.bodySmall ?? body(context))
          .copyWith(color: AppColors.muted(context));
}
