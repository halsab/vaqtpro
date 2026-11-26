import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import 'tokens.dart';
import 'theme.dart';

class AppPage extends StatelessWidget {
  const AppPage({
    super.key,
    required this.title,
    required this.child,
    this.titleContent,
    this.trailing,
  });
  final String title;
  final Widget child;
  final Widget? titleContent;
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
      appBar: m.AppBar(
        centerTitle: false,
        title: titleContent ?? Text(title),
        actions: [?trailing],
      ),
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

class AppIconButton extends StatelessWidget {
  const AppIconButton({
    super.key,
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.isLoading = false,
  });

  final String tooltip;
  final Widget icon;
  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final colors = m.Theme.of(context).colorScheme;
    return m.IconButton.filled(
      tooltip: tooltip,
      onPressed: isLoading ? null : onPressed,
      style: m.IconButton.styleFrom(
        backgroundColor: colors.primary,
        foregroundColor: colors.onPrimary,
        disabledBackgroundColor: colors.primary,
        disabledForegroundColor: colors.onPrimary,
        minimumSize: const Size(48, 48),
        fixedSize: const Size(48, 48),
        iconSize: 24,
        shape: const m.CircleBorder(),
      ),
      icon: isLoading
          ? SizedBox(
              width: 24,
              height: 24,
              child: m.CircularProgressIndicator(
                color: colors.onPrimary,
                strokeWidth: 2,
              ),
            )
          : icon,
    );
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

/// Shows a transient, non-blocking message above the app's current route.
abstract final class InternalNotification {
  static _NotificationOverlay? _active;

  static void show(BuildContext context, String message) {
    if (message.isEmpty) return;
    final overlay = Overlay.of(context, rootOverlay: true);
    if (_active case final active?) {
      if (active.overlay == overlay && active.message == message) return;
      active.dismiss();
    }
    final notification = _NotificationOverlay(overlay, message);
    _active = notification;
    notification.insert();
  }
}

class _NotificationOverlay {
  _NotificationOverlay(this.overlay, this.message);
  final OverlayState overlay;
  final String message;
  bool _removed = false;
  late final OverlayEntry entry = OverlayEntry(
    builder: (_) => _InternalNotificationView(
      message: message,
      onDismissed: () {
        if (InternalNotification._active == this) {
          InternalNotification._active = null;
        }
        _remove();
      },
    ),
  );

  void insert() => overlay.insert(entry);
  void dismiss() {
    _remove();
  }

  void _remove() {
    if (_removed) return;
    _removed = true;
    if (entry.mounted) entry.remove();
  }
}

class _InternalNotificationView extends StatefulWidget {
  const _InternalNotificationView({
    required this.message,
    required this.onDismissed,
  });

  final String message;
  final VoidCallback onDismissed;

  @override
  State<_InternalNotificationView> createState() =>
      _InternalNotificationViewState();
}

class _InternalNotificationViewState extends State<_InternalNotificationView>
    with SingleTickerProviderStateMixin {
  static const _duration = Duration(seconds: 4);
  late final AnimationController _animation;
  Timer? _timer;
  Stopwatch? _watch;
  Duration _remaining = _duration;
  double _dragOffset = 0;
  bool _held = false;
  bool _closing = false;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    _animation = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 240),
      reverseDuration: const Duration(milliseconds: 200),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduce && !_reduceMotion) {
      _animation.stop();
      _animation.value = 1;
    }
    _reduceMotion = reduce;
    if (_timer == null && !_closing) {
      if (_reduceMotion) {
        _animation.value = 1;
      } else {
        _animation.forward();
      }
      _startTimer();
    }
  }

  void _startTimer() {
    _watch = Stopwatch()..start();
    _timer = Timer(_remaining, _dismiss);
  }

  void _pauseTimer() {
    if (_held || _closing) return;
    _held = true;
    _timer?.cancel();
    _timer = null;
    _remaining -= _watch?.elapsed ?? Duration.zero;
    if (_remaining.isNegative) _remaining = Duration.zero;
    _watch?.stop();
  }

  void _resumeTimer() {
    if (!_held || _closing) return;
    _held = false;
    if (_remaining == Duration.zero) {
      _dismiss();
    } else {
      _startTimer();
    }
  }

  void _dismiss() {
    if (_closing) return;
    _closing = true;
    _timer?.cancel();
    if (_reduceMotion) {
      widget.onDismissed();
    } else {
      _animation.reverse().whenComplete(widget.onDismissed);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return Positioned(
      top: top + AppTokens.space8,
      left: AppTokens.space16,
      right: AppTokens.space16,
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: (_) => _pauseTimer(),
        onPointerUp: (_) => _resumeTimer(),
        onPointerCancel: (_) => _resumeTimer(),
        child: AnimatedBuilder(
          animation: _animation,
          builder: (context, child) {
            final progress = _animation.value;
            return Transform.translate(
              offset: Offset(0, _dragOffset + (1 - progress) * -80),
              child: Opacity(opacity: progress, child: child),
            );
          },
          child: Semantics(
            liveRegion: true,
            label: widget.message,
            child: GestureDetector(
              onVerticalDragStart: (_) {},
              onVerticalDragUpdate: (details) {
                setState(
                  () =>
                      _dragOffset = math.min(0, details.delta.dy + _dragOffset),
                );
              },
              onVerticalDragEnd: (details) {
                if (_dragOffset < -36 ||
                    details.velocity.pixelsPerSecond.dy < -300) {
                  _dismiss();
                } else {
                  setState(() => _dragOffset = 0);
                  _resumeTimer();
                }
              },
              child: m.Material(
                key: const ValueKey('internal-notification-surface'),
                color: AppColors.surface(context),
                elevation: 6,
                borderRadius: BorderRadius.circular(AppTokens.radius),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTokens.space16,
                    vertical: AppTokens.space12,
                  ),
                  child: Text(
                    widget.message,
                    style: m.Theme.of(context).textTheme.bodyMedium
                        ?.copyWith(color: AppColors.text(context)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
