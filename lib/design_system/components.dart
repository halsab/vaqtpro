import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import 'tokens.dart';
import 'theme.dart';

class AppPage extends StatelessWidget {
  const AppPage({
    super.key,
    required this.title,
    required this.child,
    this.trailing,
  });
  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final body = SafeArea(
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: AppTokens.contentWidth),
          child: child,
        ),
      ),
    );
    return m.Scaffold(
      appBar: m.AppBar(title: Text(title), actions: [?trailing]),
      body: body,
    );
  }
}

class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.primary = true,
  });
  final String label;
  final VoidCallback? onPressed;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    return primary
        ? m.FilledButton(onPressed: onPressed, child: Text(label))
        : m.TextButton(onPressed: onPressed, child: Text(label));
  }
}

class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    this.controller,
    this.onChanged,
    this.onSubmitted,
    this.enabled = true,
  });
  final String label;
  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool enabled;

  @override
  Widget build(BuildContext context) => m.TextField(
    controller: controller,
    onChanged: onChanged,
    onSubmitted: onSubmitted,
    enabled: enabled,
    decoration: m.InputDecoration(labelText: label),
  );
}

class AppSwitch extends StatelessWidget {
  const AppSwitch({super.key, required this.value, required this.onChanged});
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) =>
      m.Switch(value: value, onChanged: onChanged);
}

class AppProgress extends StatelessWidget {
  const AppProgress({super.key});

  @override
  Widget build(BuildContext context) => const m.CircularProgressIndicator();
}

Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  required String cancelLabel,
  required String confirmLabel,
  bool destructive = false,
}) async {
  return await m.showDialog<bool>(
        context: context,
        builder: (context) => m.AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            m.TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(cancelLabel),
            ),
            m.TextButton(
              style: destructive
                  ? m.TextButton.styleFrom(
                      foregroundColor: m.Theme.of(context).colorScheme.error,
                    )
                  : null,
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(confirmLabel),
            ),
          ],
        ),
      ) ??
      false;
}

class AppStateMessage extends StatelessWidget {
  const AppStateMessage({
    super.key,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: AppTokens.pagePadding,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          title,
          style: AppTextStyles.heading(context),
          textAlign: TextAlign.center,
        ),
        if (message != null) ...[
          const SizedBox(height: AppTokens.space8),
          Text(
            message!,
            style: AppTextStyles.body(context),
            textAlign: TextAlign.center,
          ),
        ],
        if (actionLabel != null && onAction != null) ...[
          const SizedBox(height: AppTokens.space16),
          AppButton(label: actionLabel!, onPressed: onAction),
        ],
      ],
    ),
  );
}
