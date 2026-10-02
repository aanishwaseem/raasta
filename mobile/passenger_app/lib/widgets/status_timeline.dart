import 'package:flutter/material.dart';

import '../util/format.dart';
import '../util/json.dart';

const _steps = [
  ('MATCHING', 'Finding driver', Icons.search),
  ('DRIVER_ASSIGNED', 'Driver assigned', Icons.person_pin_circle_outlined),
  ('DRIVER_ARRIVING', 'Arriving', Icons.directions_car_outlined),
  ('DRIVER_ARRIVED', 'Arrived', Icons.flag_outlined),
  ('IN_PROGRESS', 'On trip', Icons.route_outlined),
  ('COMPLETED', 'Completed', Icons.check_circle_outline),
];

/// Horizontal progress through the ride states, plus the terminal states (cancelled, no drivers).
class StatusTimeline extends StatelessWidget {
  const StatusTimeline({super.key, required this.status, this.timestamps});
  final String status;
  final Json? timestamps;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final failed = status == 'CANCELLED' || status == 'NO_DRIVERS';
    final idx = _steps.indexWhere((s) => s.$1 == status);
    final ts = timestamps ?? {};
    final stamp = {'MATCHING': ts['requestedAt'], 'DRIVER_ASSIGNED': ts['assignedAt'], 'DRIVER_ARRIVED': ts['arrivedAt'], 'IN_PROGRESS': ts['startedAt'], 'COMPLETED': ts['completedAt']};
    return Semantics(
      label: 'Trip progress: ${humanize(status)}',
      child: Column(children: [
        Row(children: [
          for (var i = 0; i < _steps.length; i++) ...[
            _Dot(done: !failed && idx >= i, current: !failed && idx == i, icon: _steps[i].$3),
            if (i < _steps.length - 1) Expanded(child: Container(height: 3, color: !failed && idx > i ? t.colorScheme.primary : t.colorScheme.outlineVariant)),
          ],
        ]),
        const SizedBox(height: 6),
        if (failed)
          Row(children: [
            Icon(status == 'CANCELLED' ? Icons.cancel_outlined : Icons.car_crash_outlined, size: 18, color: t.colorScheme.error),
            const SizedBox(width: 6),
            Text(status == 'CANCELLED' ? 'Ride cancelled${ts['cancelledAt'] != null ? ' at ${clock(parseTime(ts['cancelledAt'])!)}' : ''}' : 'No drivers were available', style: t.textTheme.labelLarge?.copyWith(color: t.colorScheme.error)),
          ])
        else
          Row(children: [
            Text(idx >= 0 ? _steps[idx].$2 : humanize(status), style: t.textTheme.labelLarge?.copyWith(color: t.colorScheme.primary)),
            if (idx >= 0 && parseTime(stamp[status]) != null) Text('  ·  ${clock(parseTime(stamp[status])!)}', style: t.textTheme.bodySmall),
          ]),
      ]),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.done, required this.current, required this.icon});
  final bool done;
  final bool current;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Container(
      width: current ? 30 : 24,
      height: current ? 30 : 24,
      decoration: BoxDecoration(shape: BoxShape.circle, color: done ? t.colorScheme.primary : t.colorScheme.surfaceContainerHighest, border: current ? Border.all(color: t.colorScheme.primary.withValues(alpha: 0.35), width: 4) : null),
      child: Icon(icon, size: current ? 16 : 14, color: done ? t.colorScheme.onPrimary : t.colorScheme.onSurfaceVariant),
    );
  }
}

/// Vertical list of every milestone that has a timestamp.
class TimelineDetails extends StatelessWidget {
  const TimelineDetails({super.key, required this.timestamps});
  final Json timestamps;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final rows = [
      ('Requested', timestamps['requestedAt']),
      ('Driver assigned', timestamps['assignedAt']),
      ('Driver arrived', timestamps['arrivedAt']),
      ('Trip started', timestamps['startedAt']),
      ('Trip completed', timestamps['completedAt']),
      ('Cancelled', timestamps['cancelledAt']),
    ].where((r) => parseTime(r.$2) != null).toList();
    return Column(children: [
      for (final r in rows)
        Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Row(children: [
          Icon(Icons.circle, size: 8, color: t.colorScheme.primary),
          const SizedBox(width: 10),
          Expanded(child: Text(r.$1)),
          Text(whenText(r.$2), style: t.textTheme.bodySmall),
        ])),
    ]);
  }
}
