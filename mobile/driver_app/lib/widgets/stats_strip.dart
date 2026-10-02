import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

/// Today's numbers from the copilot summary. Only shows figures the API actually returned.
class StatsStrip extends StatelessWidget {
  const StatsStrip({super.key, required this.today});
  final Map<String, dynamic> today;

  @override
  Widget build(BuildContext context) {
    if (today.isEmpty) return const SizedBox.shrink();
    final perHour = today['perHour'];
    return IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(child: StatTile(icon: Icons.local_taxi, label: 'Trips', value: '${today['trips'] ?? 0}')),
      const SizedBox(width: 8),
      Expanded(child: StatTile(icon: Icons.payments, label: 'Earned', value: money(dbl(today['net'])))),
      const SizedBox(width: 8),
      Expanded(child: StatTile(icon: Icons.schedule, label: 'Online', value: '${dbl(today['onlineHours']).toStringAsFixed(1)} h', hint: perHour == null ? null : '${money(dbl(perHour))}/h')),
    ]));
  }
}
