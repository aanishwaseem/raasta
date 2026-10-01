import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/driver_card.dart';
import '../../widgets/payment_picker.dart';
import '../../widgets/status_timeline.dart';
import 'matching_view.dart';

class TripActions {
  const TripActions({required this.onShare, required this.onSos, required this.onCancel, required this.onRate, required this.onReceipt, required this.onRetry, required this.onClose, required this.onPayCash});
  final VoidCallback onShare, onSos, onCancel, onRate, onReceipt, onClose, onPayCash;
  final void Function({bool raise}) onRetry;
}

const _titles = {
  'MATCHING': 'Finding your driver',
  'DRIVER_ASSIGNED': 'Driver on the way',
  'DRIVER_ARRIVING': 'Driver is almost there',
  'DRIVER_ARRIVED': 'Your driver has arrived',
  'IN_PROGRESS': 'On your way',
  'COMPLETED': 'Trip complete',
  'CANCELLED': 'Ride cancelled',
  'NO_DRIVERS': 'No drivers available',
};

/// Bottom-sheet content for the current ride state.
class TripPanel extends StatefulWidget {
  const TripPanel({super.key, required this.ride, required this.actions, this.busy = false});
  final Json ride;
  final TripActions actions;
  final bool busy;
  @override
  State<TripPanel> createState() => _TripPanelState();
}

class _TripPanelState extends State<TripPanel> {
  bool _details = false;

  @override
  Widget build(BuildContext context) {
    final r = widget.ride;
    final a = widget.actions;
    final t = Theme.of(context);
    final status = (r['status'] ?? '').toString();
    final fare = asJson(r['fare']);
    final driver = r['driver'] is Map ? asJson(r['driver']) : null;
    final ts = asJson(r['timestamps']);
    final pin = r['pin']?.toString();
    final preTrip = const {'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'}.contains(status);
    final live = preTrip || status == 'IN_PROGRESS';
    final pickupEta = asJson(r['etas'])['pickupEtaS'];
    final cancellable = status == 'MATCHING' || preTrip;
    final payable = fare['final'] ?? fare['payable'];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: Text(_titles[status] ?? humanize(status), style: t.textTheme.titleLarge)),
        Text(money(payable as num?), style: t.textTheme.titleLarge),
      ]),
      Text('${shortAddress(r['pickup']?['address'], parts: 1)}  →  ${shortAddress(r['dropoff']?['address'], parts: 1)}', style: t.textTheme.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
      const SizedBox(height: 12),
      if (status == 'MATCHING') MatchingView(requestedAt: parseTime(ts['requestedAt']), attempt: (r['matchAttempt'] as num?)?.toInt(), offered: money(fare['offered'] as num?)) else StatusTimeline(status: status, timestamps: ts),
      if (driver != null && status != 'CANCELLED' && status != 'NO_DRIVERS') ...[const SizedBox(height: 12), DriverCard(driver: driver)],
      if (pin != null && pin.isNotEmpty) ...[const SizedBox(height: 12), PinCard(pin: pin)],
      if ((status == 'DRIVER_ASSIGNED' || status == 'DRIVER_ARRIVING') && pickupEta is num) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Estimated pickup in about ${etaText(pickupEta)}', style: t.textTheme.bodyMedium)),
      if (status == 'IN_PROGRESS') Padding(padding: const EdgeInsets.only(top: 8), child: Text('Estimated trip time ${etaText(asJson(r['etas'])['tripEtaS'] as num?)}. Your driver should follow the route shown on the map.', style: t.textTheme.bodyMedium)),
      if (live) ...[
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: a.onShare, icon: const Icon(Icons.share_outlined), label: const Text('Share ride'))),
          const SizedBox(width: 8),
          Expanded(child: OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: raastaDanger), onPressed: a.onSos, icon: const Icon(Icons.sos), label: const Text('SOS'))),
        ]),
      ],
      if (status == 'COMPLETED') ..._completed(context, r, fare),
      if (status == 'CANCELLED') ..._cancelled(context, r, fare),
      if (status == 'NO_DRIVERS') ..._noDrivers(context, fare),
      if (cancellable) Padding(padding: const EdgeInsets.only(top: 8), child: TextButton(style: TextButton.styleFrom(foregroundColor: t.colorScheme.error, minimumSize: const Size.fromHeight(48)), onPressed: widget.busy ? null : a.onCancel, child: const Text('Cancel ride'))),
      if (ts.isNotEmpty) Align(alignment: Alignment.centerLeft, child: TextButton.icon(onPressed: () => setState(() => _details = !_details), icon: Icon(_details ? Icons.expand_less : Icons.expand_more), label: Text(_details ? 'Hide timeline' : 'Trip timeline'))),
      if (_details) TimelineDetails(timestamps: ts),
    ]);
  }

  List<Widget> _completed(BuildContext context, Json r, Json fare) {
    final a = widget.actions;
    final t = Theme.of(context);
    final method = (r['paymentMethod'] ?? 'CASH').toString();
    final failed = r['paymentStatus'] == 'FAILED';
    return [
      const SizedBox(height: 12),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: t.colorScheme.primary.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(16)),
        child: Row(children: [
          Icon(paymentIcon(method), color: t.colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(child: Text(method == 'CASH' ? 'Pay your driver ${money(fare['final'] ?? fare['payable'])} in cash' : '${paymentName(method)}: ${humanize((r['paymentStatus'] ?? 'pending').toString())}', style: t.textTheme.titleSmall)),
        ]),
      ),
      if (failed) Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton(onPressed: a.onPayCash, child: const Text('Payment failed. Pay with cash instead'))),
      const SizedBox(height: 8),
      if (r['myRating'] == null) FilledButton.icon(onPressed: a.onRate, icon: const Icon(Icons.star_rounded), label: const Text('Rate your driver')) else Center(child: Padding(padding: const EdgeInsets.all(8), child: Text('You rated this trip ${r['myRating']} stars. Thank you!', style: t.textTheme.bodyMedium))),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: OutlinedButton.icon(onPressed: a.onReceipt, icon: const Icon(Icons.receipt_long_outlined), label: const Text('Receipt'))),
        const SizedBox(width: 8),
        Expanded(child: OutlinedButton(onPressed: a.onClose, child: const Text('Done'))),
      ]),
    ];
  }

  List<Widget> _cancelled(BuildContext context, Json r, Json fare) {
    final c = asJson(r['cancellation']);
    final fee = dbl(fare['cancellationFee']);
    return [
      const SizedBox(height: 12),
      Text('${c['by'] == 'DRIVER' ? 'Your driver' : (c['by'] == 'SYSTEM' ? 'Raasta' : 'You')} cancelled this ride${c['reason'] != null ? ' (${humanize(c['reason'].toString())})' : ''}.${fee > 0 ? ' A cancellation fee of ${money(fee)} applies.' : ' You were not charged.'}'),
      const SizedBox(height: 12),
      FilledButton(onPressed: widget.actions.onClose, child: const Text('Back to home')),
    ];
  }

  List<Widget> _noDrivers(BuildContext context, Json fare) {
    final a = widget.actions;
    return [
      const SizedBox(height: 12),
      const Text('All nearby drivers were busy. Try again, or raise your offer a little to attract a driver sooner.'),
      const SizedBox(height: 12),
      FilledButton(onPressed: widget.busy ? null : () => a.onRetry(), child: const Text('Try again')),
      const SizedBox(height: 8),
      OutlinedButton(onPressed: widget.busy ? null : () => a.onRetry(raise: true), child: Text('Retry with ${money(dbl(fare['offered']) + 50)}')),
      TextButton(onPressed: a.onClose, child: const Text('Back to home')),
    ];
  }
}
