import 'package:flutter/material.dart';

import 'theme.dart';

/// Shared building blocks so the rider and driver apps look like one product.

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.action, this.onAction});
  final String text;
  final String? action;
  final VoidCallback? onAction;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
        child: Row(children: [
          Expanded(child: Text(text, style: Theme.of(context).textTheme.titleMedium)),
          if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
        ]),
      );
}

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.icon, this.hint});
  final String label;
  final String value;
  final IconData? icon;
  final String? hint;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (icon != null) Icon(icon, size: 16, color: t.colorScheme.primary),
            if (icon != null) const SizedBox(width: 6),
            Flexible(child: Text(label, style: t.textTheme.labelMedium?.copyWith(color: t.colorScheme.onSurfaceVariant), overflow: TextOverflow.ellipsis)),
          ]),
          const SizedBox(height: 6),
          Text(value, style: t.textTheme.titleLarge),
          if (hint != null) Text(hint!, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant)),
        ]),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action, this.onAction});
  final IconData icon;
  final String title;
  final String? message;
  final String? action;
  final VoidCallback? onAction;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          CircleAvatar(radius: 34, backgroundColor: t.colorScheme.primary.withValues(alpha: 0.12), child: Icon(icon, size: 32, color: t.colorScheme.primary)),
          const SizedBox(height: 16),
          Text(title, style: t.textTheme.titleMedium, textAlign: TextAlign.center),
          if (message != null) ...[const SizedBox(height: 6), Text(message!, textAlign: TextAlign.center, style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.onSurfaceVariant))],
          if (action != null) ...[const SizedBox(height: 16), SizedBox(width: 200, child: OutlinedButton(onPressed: onAction, child: Text(action!)))],
        ]),
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => EmptyState(icon: Icons.cloud_off_outlined, title: 'Something went wrong', message: message, action: onRetry == null ? null : 'Try again', onAction: onRetry);
}

/// Grey placeholder rows while data loads.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 4, this.height = 72});
  final int count;
  final double height;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme.outlineVariant.withValues(alpha: 0.35);
    return Column(children: [
      for (var i = 0; i < count; i++) Container(height: height, margin: const EdgeInsets.only(bottom: 10), decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(16))),
    ]);
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.text, {super.key, this.color});
  final String text;
  final Color? color;
  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.primary;
    return Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4), decoration: BoxDecoration(color: c.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(20)), child: Text(text, style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w700)));
  }
}

class RatingStars extends StatelessWidget {
  const RatingStars({super.key, required this.value, required this.onChanged, this.size = 40});
  final int value;
  final ValueChanged<int> onChanged;
  final double size;
  @override
  Widget build(BuildContext context) => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 1; i <= 5; i++) IconButton(iconSize: size, onPressed: () => onChanged(i), icon: Icon(i <= value ? Icons.star_rounded : Icons.star_outline_rounded, color: raastaAmber)),
      ]);
}

/// Card with an icon, title, subtitle and optional trailing widget; the standard list row everywhere.
class InfoTile extends StatelessWidget {
  const InfoTile({super.key, required this.icon, required this.title, this.subtitle, this.trailing, this.onTap, this.color});
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? color;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final c = color ?? t.colorScheme.primary;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(children: [
            CircleAvatar(radius: 20, backgroundColor: c.withValues(alpha: 0.12), child: Icon(icon, color: c, size: 20)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              if (subtitle != null) Text(subtitle!, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant)),
            ])),
            if (trailing != null) trailing! else if (onTap != null) Icon(Icons.chevron_right, color: t.colorScheme.onSurfaceVariant),
          ]),
        ),
      ),
    );
  }
}

/// Panel that sits over the bottom of a map, like the sheet in a ride-hailing app.
class MapSheet extends StatelessWidget {
  const MapSheet({super.key, required this.child, this.padding = const EdgeInsets.fromLTRB(16, 8, 16, 16)});
  final Widget child;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.surface, borderRadius: const BorderRadius.vertical(top: Radius.circular(24)), boxShadow: const [BoxShadow(blurRadius: 24, color: Color(0x33000000))]),
        child: SafeArea(top: false, child: Padding(padding: padding, child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 40, height: 4, margin: const EdgeInsets.only(bottom: 10), decoration: BoxDecoration(color: Theme.of(context).colorScheme.outlineVariant, borderRadius: BorderRadius.circular(2))),
          child,
        ]))),
      );
}

/// Shows an error as a friendly snack bar. Never pass raw exceptions here.
void toast(BuildContext context, String message) => ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(SnackBar(content: Text(message)));

/// Loads async data with skeleton, error and empty handling so screens stay short.
class AsyncBody<T> extends StatefulWidget {
  const AsyncBody({super.key, required this.load, required this.builder, this.isEmpty, this.empty});
  final Future<T> Function() load;
  final Widget Function(BuildContext, T, Future<void> Function() refresh) builder;
  final bool Function(T)? isEmpty;
  final Widget? empty;
  @override
  State<AsyncBody<T>> createState() => _AsyncBodyState<T>();
}

class _AsyncBodyState<T> extends State<AsyncBody<T>> {
  T? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    if (mounted) setState(() { _loading = _data == null; _error = null; });
    try {
      final d = await widget.load();
      if (mounted) setState(() { _data = d; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e is Exception && e.toString().isNotEmpty ? _friendly(e) : 'Please try again.'; _loading = false; });
    }
  }

  String _friendly(Object e) {
    final f = (e as dynamic).friendly;
    return f is String ? f : 'Please try again.';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Padding(padding: EdgeInsets.all(16), child: SkeletonList());
    if (_error != null && _data == null) return ErrorState(message: _error!, onRetry: _run);
    final d = _data as T;
    if (widget.isEmpty?.call(d) ?? false) return widget.empty ?? const SizedBox.shrink();
    return widget.builder(context, d, _run);
  }
}
