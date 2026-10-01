import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/driver_card.dart';
import '../../widgets/load_view.dart';
import '../../widgets/payment_picker.dart';
import '../../widgets/ride_tile.dart';
import '../../widgets/status_timeline.dart';
import '../profile/new_ticket_sheet.dart';
import '../trip/rating_screen.dart';
import 'receipt_screen.dart';

/// A past ride: route, driver, fare, timeline, receipt, rating and help.
class RideDetailScreen extends StatelessWidget {
  const RideDetailScreen({super.key, required this.api, required this.rideId, required this.location});
  final ApiClient api;
  final String rideId;
  final DeviceLocation location;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ride details')),
      body: LoadView<Json>(
        load: () async => asJson(await api.get('/rides/$rideId')),
        builder: (context, r, reload) => _body(context, r, reload),
      ),
    );
  }

  List<Widget> _body(BuildContext context, Json r, Future<void> Function() reload) {
    final t = Theme.of(context);
    final status = (r['status'] ?? '').toString();
    final fare = asJson(r['fare']);
    final p = asJson(r['pickup']), d = asJson(r['dropoff']);
    final route = [for (final e in (r['route'] as List? ?? const [])) [dbl((e as List)[0]), dbl(e[1])]];
    final hasReceipt = status == 'COMPLETED' || dbl(fare['cancellationFee']) > 0;
    final method = (r['paymentMethod'] ?? 'CASH').toString();
    return [
      MapView(height: 190, route: route, pins: [MapPin(dbl(p['lat']), dbl(p['lng']), icon: Icons.trip_origin, label: 'Pickup'), MapPin(dbl(d['lat']), dbl(d['lng']), icon: Icons.flag, color: raastaAmber, label: 'Drop-off')]),
      const SizedBox(height: 12),
      Row(children: [Expanded(child: Text(whenText((r['timestamps'] as Map?)?['requestedAt']), style: t.textTheme.titleMedium)), StatusPill(statusLabel(status), color: statusColor(context, status))]),
      const SizedBox(height: 8),
      Row(children: [const Icon(Icons.trip_origin, size: 16), const SizedBox(width: 8), Expanded(child: Text('${p['address'] ?? ''}'))]),
      const SizedBox(height: 6),
      Row(children: [const Icon(Icons.flag, size: 16, color: raastaAmber), const SizedBox(width: 8), Expanded(child: Text('${d['address'] ?? ''}'))]),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(child: StatTile(label: 'Fare', value: money((fare['final'] ?? fare['payable']) as num?), icon: Icons.payments_outlined)),
        const SizedBox(width: 8),
        Expanded(child: StatTile(label: 'Distance', value: km(r['distanceM'] as num?), icon: Icons.route_outlined, hint: '${r['productName'] ?? ''}')),
      ]),
      const SizedBox(height: 8),
      InfoTile(icon: paymentIcon(method), title: paymentName(method), subtitle: humanize((r['paymentStatus'] ?? 'pending').toString())),
      if (r['driver'] is Map) ...[const SectionTitle('Driver'), DriverCard(driver: asJson(r['driver']))],
      const SectionTitle('Timeline'),
      StatusTimeline(status: status, timestamps: asJson(r['timestamps'])),
      const SizedBox(height: 8),
      TimelineDetails(timestamps: asJson(r['timestamps'])),
      const SizedBox(height: 16),
      if (hasReceipt) FilledButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ReceiptScreen(api: api, rideId: rideId))), icon: const Icon(Icons.receipt_long_outlined), label: const Text('View receipt')),
      if (status == 'COMPLETED' && r['myRating'] == null) ...[
        const SizedBox(height: 8),
        OutlinedButton.icon(onPressed: () async { final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => RatingScreen(api: api, rideId: rideId, driver: r['driver'] is Map ? asJson(r['driver']) : null))); if (ok == true) reload(); }, icon: const Icon(Icons.star_outline_rounded), label: const Text('Rate this trip')),
      ] else if (r['myRating'] != null)
        Padding(padding: const EdgeInsets.only(top: 8), child: Center(child: Text('You rated this trip ${r['myRating']} out of 5.', style: t.textTheme.bodyMedium))),
      const SizedBox(height: 8),
      OutlinedButton.icon(onPressed: () => showNewTicketSheet(context, api, rideId: rideId), icon: const Icon(Icons.support_agent_outlined), label: const Text('Get help with this ride')),
    ];
  }
}
