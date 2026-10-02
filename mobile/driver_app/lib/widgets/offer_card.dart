import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import 'countdown_ring.dart';

/// Incoming ride request: fare, pickup distance/ETA, places, big Accept / Decline.
class OfferCard extends StatelessWidget {
  const OfferCard({super.key, required this.offer, required this.onAccept, required this.onDecline, required this.onExpire, this.busy = false});
  final Map<String, dynamic> offer;
  final VoidCallback onAccept;
  final VoidCallback onDecline;
  final VoidCallback onExpire;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final muted = t.colorScheme.onSurfaceVariant;
    final passenger = asMap(offer['passenger']);
    final dropoff = offer['dropoffAddress'] ?? asMap(offer['dropoffArea'])['address'] ?? 'Drop-off';
    final eta = offer['pickupEtaS'] == null ? '' : ' · ${minutes(offer['pickupEtaS'] as num)}';
    return MapSheet(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          CountdownRing(key: ValueKey(offer['offerId']), expiresAt: when(offer['expiresAt']), onExpire: onExpire),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(money(offer['fare'] as num?), style: t.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w900)),
            Wrap(spacing: 8, children: [
              StatusPill('${offer['paymentMethod'] ?? 'CASH'}'.toLowerCase().replaceFirstMapped(RegExp('^.'), (m) => m[0]!.toUpperCase())),
              if (offer['shared'] == true) const StatusPill('Shared ride', color: raastaAmber),
              if (passenger['rating'] != null) StatusPill('Rider ${dbl(passenger['rating']).toStringAsFixed(1)} ★', color: raastaAmber),
            ]),
          ])),
        ]),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: _Metric(icon: Icons.my_location, text: '${km(offer['pickupDistanceM'] as num?)}$eta', caption: 'to pickup')),
          Expanded(child: _Metric(icon: Icons.route, text: km(offer['tripDistanceM'] as num?), caption: offer['tripDurationS'] == null ? 'trip' : 'trip · ${minutes(offer['tripDurationS'] as num)}')),
        ]),
        const SizedBox(height: 8),
        _Place(icon: Icons.trip_origin, color: goGreen, text: '${offer['pickupAddress'] ?? 'Pickup'}'),
        _Place(icon: Icons.location_on, color: raastaAmber, text: '$dropoff'),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: busy ? null : onDecline, style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(64), foregroundColor: muted), child: const Text('Decline'))),
          const SizedBox(width: 12),
          Expanded(flex: 2, child: FilledButton(onPressed: busy ? null : onAccept, style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(64), backgroundColor: goGreen, foregroundColor: Colors.black, textStyle: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)), child: busy ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 3, color: Colors.black)) : const Text('Accept'))),
        ]),
      ]),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.icon, required this.text, required this.caption});
  final IconData icon;
  final String text;
  final String caption;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Row(children: [
      Icon(icon, size: 20, color: t.colorScheme.primary),
      const SizedBox(width: 8),
      Flexible(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(text, style: t.textTheme.titleMedium, overflow: TextOverflow.ellipsis),
        Text(caption, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant)),
      ])),
    ]);
  }
}

class _Place extends StatelessWidget {
  const _Place({required this.icon, required this.color, required this.text});
  final IconData icon;
  final Color color;
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [Icon(icon, color: color, size: 22), const SizedBox(width: 10), Expanded(child: Text(text, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodyLarge))]),
      );
}
