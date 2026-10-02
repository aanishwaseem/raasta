import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/format.dart';
import '../util/json.dart';
import 'product_icon.dart';

Color statusColor(BuildContext context, String status) {
  switch (status) {
    case 'COMPLETED':
      return Colors.green.shade700;
    case 'CANCELLED':
    case 'NO_DRIVERS':
      return Theme.of(context).colorScheme.error;
    default:
      return Theme.of(context).colorScheme.primary;
  }
}

String statusLabel(String s) => s == 'NO_DRIVERS' ? 'No drivers' : s == 'IN_PROGRESS' ? 'On trip' : humanize(s);

/// A row in ride history (item of GET /rides).
class RideTile extends StatelessWidget {
  const RideTile({super.key, required this.ride, required this.onTap});
  final Json ride;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final status = (ride['status'] ?? '').toString();
    final fare = ride['finalFare'] ?? ((ride['offeredFare'] as num?) == null ? null : (ride['offeredFare'] as num) - dbl(ride['discount']));
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            CircleAvatar(backgroundColor: t.colorScheme.primary.withValues(alpha: 0.12), child: Icon(productIcon((ride['productCode'] ?? '').toString()), color: t.colorScheme.primary)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(shortAddress(ride['dropoffAddress'], parts: 1), style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                Text('From ${shortAddress(ride['pickupAddress'], parts: 1)}', style: t.textTheme.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 4),
                Text(whenText(ride['requestedAt']), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant)),
              ]),
            ),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(money(status == 'COMPLETED' ? fare as num? : null), style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              StatusPill(statusLabel(status), color: statusColor(context, status)),
            ]),
          ]),
        ),
      ),
    );
  }
}
