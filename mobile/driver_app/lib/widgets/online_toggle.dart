import 'package:flutter/material.dart';

import '../util.dart';

/// Big slide-or-tap switch for going online / offline. Slide the thumb across or tap anywhere.
class OnlineToggle extends StatefulWidget {
  const OnlineToggle({super.key, required this.online, required this.busy, required this.onToggle});
  final bool online;
  final bool busy;
  final VoidCallback onToggle;

  @override
  State<OnlineToggle> createState() => _OnlineToggleState();
}

class _OnlineToggleState extends State<OnlineToggle> {
  double _p = 0; // progress toward the other state while dragging

  static const _h = 68.0;

  @override
  Widget build(BuildContext context) {
    final online = widget.online;
    final color = online ? goGreen : Theme.of(context).colorScheme.primary;
    return LayoutBuilder(builder: (context, c) {
      final travel = c.maxWidth - _h;
      final t = online ? 1 - _p : _p;
      return Semantics(
        button: true,
        label: online ? 'Go offline' : 'Go online',
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.busy ? null : widget.onToggle,
          onHorizontalDragUpdate: widget.busy ? null : (d) => setState(() => _p = (_p + (online ? -d.delta.dx : d.delta.dx) / travel).clamp(0.0, 1.0)),
          onHorizontalDragEnd: (_) {
            final go = _p > 0.6;
            setState(() => _p = 0);
            if (go && !widget.busy) widget.onToggle();
          },
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            height: _h,
            decoration: BoxDecoration(color: color.withValues(alpha: online ? 0.22 : 0.14), borderRadius: BorderRadius.circular(_h / 2), border: Border.all(color: color, width: 2)),
            child: Stack(alignment: Alignment.centerLeft, children: [
              Center(child: Padding(padding: EdgeInsets.only(left: online ? 0 : _h * 0.6, right: online ? _h * 0.6 : 0), child: Text(online ? 'Go offline' : 'Go online', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: color, fontWeight: FontWeight.w800)))),
              Positioned(
                left: t * travel,
                child: Container(
                  width: _h,
                  height: _h,
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                  child: widget.busy ? const Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator(strokeWidth: 3, color: Colors.black)) : Icon(online ? Icons.pause_rounded : Icons.power_settings_new_rounded, color: Colors.black, size: 34),
                ),
              ),
            ]),
          ),
        ),
      );
    });
  }
}
