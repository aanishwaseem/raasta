import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../util/place.dart';
import '../../widgets/place_field.dart';

/// Pickup and destination inputs with saved-place shortcuts.
class RouteEditor extends StatelessWidget {
  const RouteEditor({super.key, required this.api, required this.pickup, required this.dropoff, required this.saved, required this.onPickup, required this.onDropoff, required this.onEdited});
  final ApiClient api;
  final Place? pickup;
  final Place? dropoff;
  final List<Place> saved;
  final ValueChanged<Place> onPickup;
  final ValueChanged<Place> onDropoff;
  final VoidCallback onEdited;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      PlaceField(api: api, label: 'Pickup', icon: Icons.trip_origin, iconColor: Theme.of(context).colorScheme.primary, initial: pickup, shortcuts: saved, near: pickup, onPicked: onPickup, onEdited: onEdited),
      const SizedBox(height: 8),
      PlaceField(api: api, label: 'Where to?', icon: Icons.flag_outlined, iconColor: raastaAmber, initial: dropoff, shortcuts: saved, near: pickup, autofocus: dropoff == null, onPicked: onDropoff, onEdited: onEdited),
    ]);
  }
}

/// Collapsed route: where from, where to, with an edit button.
class RouteSummary extends StatelessWidget {
  const RouteSummary({super.key, required this.pickup, required this.dropoff, required this.onEdit, this.detail});
  final Place pickup;
  final Place dropoff;
  final VoidCallback onEdit;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    Widget line(IconData i, Color c, String text) => Row(children: [Icon(i, size: 16, color: c), const SizedBox(width: 8), Expanded(child: Text(shortAddress(text), maxLines: 1, overflow: TextOverflow.ellipsis, style: t.textTheme.titleSmall))]);
    return Row(children: [
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          line(Icons.trip_origin, t.colorScheme.primary, pickup.address),
          const SizedBox(height: 6),
          line(Icons.flag, raastaAmber, dropoff.address),
          if (detail != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(detail!, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant))),
        ]),
      ),
      TextButton.icon(onPressed: onEdit, icon: const Icon(Icons.edit_outlined, size: 18), label: const Text('Edit')),
    ]);
  }
}

/// Rider's offer, bounded by what the server says drivers are likely to accept.
class OfferStepper extends StatelessWidget {
  const OfferStepper({super.key, required this.fare, required this.offer, required this.onChanged});
  final Json fare;
  final int offer;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final rec = dbl(fare['recommended']).round();
    final min = dbl(fare['minimumReasonable'], rec.toDouble()).round();
    final max = dbl(fare['high'], rec.toDouble()).round();
    final matchMin = asJson(fare['expectedMatchSeconds'])['atMinimum'];
    final low = offer < rec;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text('Your offer', style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700))),
        IconButton.outlined(tooltip: 'Lower offer', onPressed: offer - 10 >= min ? () => onChanged(offer - 10) : null, icon: const Icon(Icons.remove)),
        SizedBox(width: 88, child: Text(money(offer), textAlign: TextAlign.center, style: t.textTheme.titleMedium)),
        IconButton.outlined(tooltip: 'Raise offer', onPressed: offer + 10 <= max ? () => onChanged(offer + 10) : null, icon: const Icon(Icons.add)),
      ]),
      Text(
        low && matchMin is num ? 'Recommended ${money(rec)}. Offering less may mean waiting about ${etaText(matchMin)} for a driver.' : 'Recommended ${money(rec)}. Drivers are likely to accept ${money(min)} or more.',
        style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant),
      ),
    ]);
  }
}

class BookingExtras extends StatelessWidget {
  const BookingExtras({super.key, required this.promo, required this.onApplyPromo, required this.safety, required this.onSafety, required this.promoMessage, this.promoOk = false, this.seats, this.maxSeats = 1, this.onSeats});
  final TextEditingController promo;
  final VoidCallback onApplyPromo;
  final bool safety;
  final ValueChanged<bool> onSafety;
  final String? promoMessage;
  final bool promoOk;
  final int? seats;
  final int maxSeats;
  final ValueChanged<int>? onSeats;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: TextField(controller: promo, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Promo code', prefixIcon: Icon(Icons.local_offer_outlined)))),
        const SizedBox(width: 8),
        SizedBox(height: 56, child: OutlinedButton(style: OutlinedButton.styleFrom(minimumSize: const Size(80, 56)), onPressed: onApplyPromo, child: const Text('Apply'))),
      ]),
      if (promoMessage != null) Padding(padding: const EdgeInsets.only(top: 6, left: 4), child: Text(promoMessage!, style: t.textTheme.bodySmall?.copyWith(color: promoOk ? Colors.green.shade700 : t.colorScheme.error))),
      if (seats != null && onSeats != null)
        Row(children: [
          const Icon(Icons.people_alt_outlined),
          const SizedBox(width: 12),
          const Expanded(child: Text('Seats')),
          IconButton.outlined(tooltip: 'Fewer seats', onPressed: seats! > 1 ? () => onSeats!(seats! - 1) : null, icon: const Icon(Icons.remove)),
          SizedBox(width: 36, child: Text('$seats', textAlign: TextAlign.center, style: t.textTheme.titleMedium)),
          IconButton.outlined(tooltip: 'More seats', onPressed: seats! < maxSeats ? () => onSeats!(seats! + 1) : null, icon: const Icon(Icons.add)),
        ]),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        secondary: const Icon(Icons.shield_outlined),
        title: const Text('Safety mode'),
        subtitle: const Text('Share this trip with your trusted contacts and watch the route for deviations.'),
        value: safety,
        onChanged: onSafety,
      ),
    ]);
  }
}
