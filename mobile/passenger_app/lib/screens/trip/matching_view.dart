import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../util/format.dart';

/// Radar-style animation shown while the platform looks for a driver.
class MatchingView extends StatefulWidget {
  const MatchingView({super.key, required this.requestedAt, this.attempt, this.offered});
  final DateTime? requestedAt;
  final int? attempt;
  final String? offered;

  @override
  State<MatchingView> createState() => _MatchingViewState();
}

class _MatchingViewState extends State<MatchingView> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  String _elapsed() {
    final r = widget.requestedAt;
    if (r == null) return '';
    final s = DateTime.now().difference(r).inSeconds.clamp(0, 3600);
    return '${s ~/ 60}:${two(s % 60)}';
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final c = t.colorScheme.primary;
    return Semantics(
      label: 'Finding your driver',
      child: Column(children: [
        SizedBox(
          height: 130,
          child: AnimatedBuilder(
            animation: _c,
            builder: (context, _) => CustomPaint(
              painter: _RadarPainter(_c.value, c),
              child: Center(child: Container(width: 52, height: 52, decoration: BoxDecoration(shape: BoxShape.circle, color: c), child: Icon(Icons.directions_car_filled, color: t.colorScheme.onPrimary))),
            ),
          ),
        ),
        const SizedBox(height: 4),
        AnimatedBuilder(
          animation: _c,
          builder: (context, _) => Text('Searching nearby drivers${_elapsed().isEmpty ? '' : '  ·  ${_elapsed()}'}', style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.onSurfaceVariant)),
        ),
        if ((widget.attempt ?? 0) > 1) Text('Widening the search (round ${widget.attempt})', style: t.textTheme.bodySmall),
        if (widget.offered != null) Text('Your offer ${widget.offered}', style: t.textTheme.bodySmall),
      ]),
    );
  }
}

class _RadarPainter extends CustomPainter {
  _RadarPainter(this.t, this.color);
  final double t;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final maxR = math.min(size.width, size.height) / 2 + 20;
    for (var i = 0; i < 3; i++) {
      final p = (t + i / 3) % 1;
      canvas.drawCircle(center, 26 + (maxR - 26) * p, Paint()..color = color.withValues(alpha: (1 - p) * 0.35)..style = PaintingStyle.stroke..strokeWidth = 3);
    }
  }

  @override
  bool shouldRepaint(_RadarPainter old) => old.t != t || old.color != color;
}
