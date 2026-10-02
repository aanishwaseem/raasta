import 'dart:async';

import 'package:flutter/material.dart';

import '../util.dart';

/// Ring that drains until [expiresAt]; calls [onExpire] once at zero. Key it by offer id.
class CountdownRing extends StatefulWidget {
  const CountdownRing({super.key, required this.expiresAt, required this.onExpire, this.size = 72, this.fallbackSeconds = 15});
  final DateTime? expiresAt;
  final VoidCallback onExpire;
  final double size;
  final int fallbackSeconds;

  @override
  State<CountdownRing> createState() => _CountdownRingState();
}

class _CountdownRingState extends State<CountdownRing> {
  late final DateTime _end = widget.expiresAt ?? DateTime.now().add(Duration(seconds: widget.fallbackSeconds));
  late final double _total = _end.difference(DateTime.now()).inMilliseconds.clamp(1000, 120000) / 1000;
  Timer? _timer;
  double _left = 1;
  bool _fired = false;

  @override
  void initState() {
    super.initState();
    _left = _remaining();
    _timer = Timer.periodic(const Duration(milliseconds: 250), (_) => _tick());
  }

  double _remaining() => _end.difference(DateTime.now()).inMilliseconds / 1000;

  void _tick() {
    if (!mounted) return;
    setState(() => _left = _remaining());
    if (_left <= 0 && !_fired) {
      _fired = true;
      _timer?.cancel();
      widget.onExpire();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final secs = _left.clamp(0, 999).ceil();
    final urgent = _left <= 5;
    return Semantics(
      label: '$secs seconds left to respond',
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: Stack(alignment: Alignment.center, children: [
          SizedBox.expand(child: CircularProgressIndicator(value: (_left / _total).clamp(0.0, 1.0), strokeWidth: 7, strokeCap: StrokeCap.round, backgroundColor: Colors.white12, color: urgent ? sosRed : goGreen)),
          Text('$secs', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: urgent ? sosRed : Colors.white)),
        ]),
      ),
    );
  }
}
