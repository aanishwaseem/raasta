import 'package:flutter/material.dart';

/// Simple bar chart drawn with CustomPaint (no chart package). One value per label.
class BarChart extends StatelessWidget {
  const BarChart({super.key, required this.values, required this.labels, this.height = 140, this.color});
  final List<double> values;
  final List<String> labels;
  final double height;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final c = color ?? t.colorScheme.primary;
    final step = (labels.length / 6).ceil().clamp(1, 99);
    return Semantics(
      label: 'Bar chart with ${values.length} bars',
      child: Column(children: [
        SizedBox(height: height, width: double.infinity, child: CustomPaint(painter: _BarPainter(values, c, t.colorScheme.outlineVariant))),
        const SizedBox(height: 6),
        Row(children: [for (var i = 0; i < labels.length; i++) Expanded(child: Text(i % step == 0 ? labels[i] : '', textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.clip, style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.onSurfaceVariant)))]),
      ]),
    );
  }
}

class _BarPainter extends CustomPainter {
  _BarPainter(this.values, this.color, this.grid);
  final List<double> values;
  final Color color;
  final Color grid;

  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()..color = grid..strokeWidth = 1;
    for (var i = 0; i <= 2; i++) {
      final y = size.height - i * size.height / 2;
      canvas.drawLine(Offset(0, y == size.height ? y - 0.5 : y), Offset(size.width, y == size.height ? y - 0.5 : y), line);
    }
    if (values.isEmpty) return;
    final max = values.reduce((a, b) => a > b ? a : b);
    final slot = size.width / values.length;
    final w = (slot * 0.6).clamp(4.0, 40.0);
    for (var i = 0; i < values.length; i++) {
      final h = max <= 0 ? 0.0 : (values[i] / max) * (size.height - 8);
      final x = i * slot + (slot - w) / 2;
      final paint = Paint()..color = i == values.length - 1 ? color : color.withValues(alpha: 0.55);
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, size.height - h - 1, w, h < 2 && values[i] > 0 ? 2 : h), const Radius.circular(4)), paint);
    }
  }

  @override
  bool shouldRepaint(_BarPainter old) => old.values != values || old.color != color;
}

/// Horizontal stacked bar for splits such as busy vs idle time.
class SplitBar extends StatelessWidget {
  const SplitBar({super.key, required this.parts});
  final List<({String label, double value, Color color})> parts;

  @override
  Widget build(BuildContext context) {
    final total = parts.fold<double>(0, (s, p) => s + p.value);
    final t = Theme.of(context);
    if (total <= 0) return Text('No online time recorded in this period.', style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.onSurfaceVariant));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(height: 18, child: Row(children: [for (final p in parts) if (p.value > 0) Expanded(flex: (p.value * 1000).round().clamp(1, 1 << 30), child: Container(color: p.color))])),
      ),
      const SizedBox(height: 8),
      Wrap(spacing: 16, runSpacing: 4, children: [
        for (final p in parts) Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.circle, size: 12, color: p.color), const SizedBox(width: 6), Text('${p.label} ${p.value.toStringAsFixed(1)} h', style: t.textTheme.bodySmall)]),
      ]),
    ]);
  }
}
