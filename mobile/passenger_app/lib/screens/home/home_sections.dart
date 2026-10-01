import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/product_icon.dart';

/// "Where to?" card floating over the map, with a mic for voice/typed booking.
class WhereToCard extends StatelessWidget {
  const WhereToCard({super.key, required this.onTap, required this.onMic});
  final VoidCallback onTap;
  final VoidCallback onMic;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Material(
      elevation: 6,
      shadowColor: Colors.black54,
      color: t.colorScheme.surface,
      borderRadius: BorderRadius.circular(20),
      child: Row(children: [
        Expanded(
          child: InkWell(
            borderRadius: const BorderRadius.horizontal(left: Radius.circular(20)),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              child: Row(children: [Icon(Icons.search, color: t.colorScheme.primary), const SizedBox(width: 12), Text('Where to?', style: t.textTheme.titleMedium)]),
            ),
          ),
        ),
        IconButton(tooltip: 'Book by voice', iconSize: 28, constraints: const BoxConstraints(minWidth: 56, minHeight: 56), onPressed: onMic, icon: Icon(Icons.mic, color: t.colorScheme.primary)),
      ]),
    );
  }
}

class GreetingBar extends StatelessWidget {
  const GreetingBar({super.key, required this.name, required this.onAssistant});
  final String name;
  final VoidCallback onAssistant;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Row(children: [
      Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(color: t.colorScheme.surface.withValues(alpha: 0.92), borderRadius: BorderRadius.circular(16)),
          child: Text(name.isEmpty ? '${greeting()}, where to?' : 'Hi $name, ${greeting().toLowerCase()}', style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800), maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ),
      const SizedBox(width: 8),
      IconButton.filledTonal(tooltip: 'Raasta Assistant', constraints: const BoxConstraints(minWidth: 48, minHeight: 48), onPressed: onAssistant, icon: const Icon(Icons.auto_awesome)),
    ]);
  }
}

/// A usual-trip suggestion. It never books by itself: "Book this trip" opens the booking screen pre-filled.
class SuggestionCard extends StatelessWidget {
  const SuggestionCard({super.key, required this.s, required this.onBook, required this.onDismiss});
  final Json s;
  final VoidCallback onBook;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(productIcon('${s['productCode']}'), color: t.colorScheme.primary),
            const SizedBox(width: 10),
            Expanded(child: Text('${s['title'] ?? 'Your usual trip?'}', style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800))),
          ]),
          const SizedBox(height: 6),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(Icons.lightbulb_outline, size: 16, color: t.colorScheme.onSurfaceVariant),
            const SizedBox(width: 6),
            Expanded(child: Text('Why you are seeing this: ${s['reason'] ?? 'based on your past trips'}', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant))),
          ]),
          const SizedBox(height: 4),
          Text('Around ${whenText(s['suggestedPickupAt'])} · typically ${money(s['typicalFare'] as num?)}', style: t.textTheme.bodySmall),
          const SizedBox(height: 8),
          Row(children: [
            TextButton(onPressed: onDismiss, child: const Text('Not now')),
            const SizedBox(width: 8),
            Expanded(child: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: onBook, child: const Text('Book this trip'))),
          ]),
        ]),
      ),
    );
  }
}

class ActiveRideCard extends StatelessWidget {
  const ActiveRideCard({super.key, required this.ride, required this.onTap});
  final Json ride;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Card(
      color: t.colorScheme.primary,
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Icon(Icons.local_taxi, color: t.colorScheme.onPrimary),
            const SizedBox(width: 12),
            Expanded(child: Text('Ride in progress to ${shortAddress(asJson(ride['dropoff'])['address'], parts: 1)}\nTap to track', style: TextStyle(color: t.colorScheme.onPrimary, fontWeight: FontWeight.w700))),
            Icon(Icons.chevron_right, color: t.colorScheme.onPrimary),
          ]),
        ),
      ),
    );
  }
}
