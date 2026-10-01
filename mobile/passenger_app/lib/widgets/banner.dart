import 'package:flutter/material.dart';

/// Inline notice with an optional action: used for offline, stale-data and error messages.
class InlineBanner extends StatelessWidget {
  const InlineBanner(this.message, {super.key, this.icon = Icons.wifi_off_rounded, this.action, this.onAction, this.tone});
  final String message;
  final IconData icon;
  final String? action;
  final VoidCallback? onAction;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final c = tone ?? t.colorScheme.error;
    return Semantics(
      liveRegion: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: c.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(12), border: Border.all(color: c.withValues(alpha: 0.35))),
        child: Row(children: [
          Icon(icon, size: 20, color: c),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: t.textTheme.bodyMedium)),
          if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
        ]),
      ),
    );
  }
}
