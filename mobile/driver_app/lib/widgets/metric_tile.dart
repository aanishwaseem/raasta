import 'package:flutter/material.dart';

/// Like the kit's StatTile but the value shrinks to fit, so big numbers never wrap or overflow a fixed-height grid cell.
class MetricTile extends StatelessWidget {
  const MetricTile({super.key, required this.label, required this.value, this.icon, this.hint});
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
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Row(children: [
            if (icon != null) ...[Icon(icon, size: 16, color: t.colorScheme.primary), const SizedBox(width: 6)],
            Flexible(child: Text(label, style: t.textTheme.labelMedium?.copyWith(color: t.colorScheme.onSurfaceVariant), maxLines: 1, overflow: TextOverflow.ellipsis)),
          ]),
          const SizedBox(height: 6),
          FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: t.textTheme.titleLarge)),
          if (hint != null) Text(hint!, maxLines: 1, overflow: TextOverflow.ellipsis, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant)),
        ]),
      ),
    );
  }
}
