import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/json.dart';

class DriverCard extends StatelessWidget {
  const DriverCard({super.key, required this.driver});
  final Json driver;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final v = asJson(driver['vehicle']);
    final name = (driver['firstName'] ?? 'Your driver').toString();
    final rating = driver['rating'];
    final car = [v['color'], v['make'], v['model']].where((e) => e != null && e.toString().isNotEmpty).join(' ');
    final plate = v['plateNumber']?.toString();
    final badges = driver['badges'] is List ? (driver['badges'] as List).map((e) => e.toString()).toList() : <String>[];
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: t.colorScheme.surfaceContainerHighest.withValues(alpha: 0.4), borderRadius: BorderRadius.circular(16)),
      child: Row(children: [
        CircleAvatar(radius: 26, backgroundColor: t.colorScheme.primary.withValues(alpha: 0.15), child: Text(name.isEmpty ? '?' : name[0].toUpperCase(), style: t.textTheme.titleLarge?.copyWith(color: t.colorScheme.primary))),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(child: Text(name, style: t.textTheme.titleMedium, overflow: TextOverflow.ellipsis)),
              if (rating is num) ...[const SizedBox(width: 8), const Icon(Icons.star_rounded, size: 18, color: raastaAmber), Text(rating.toStringAsFixed(2), style: t.textTheme.labelLarge), Text(' (${driver['ratingCount'] ?? 0})', style: t.textTheme.bodySmall)],
            ]),
            if (car.isNotEmpty) Text(car, style: t.textTheme.bodyMedium),
            if (badges.isNotEmpty) Text(badges.take(2).map((b) => b.toString().split('_').map((w) => w.isEmpty ? w : '${w[0]}${w.substring(1).toLowerCase()}').join(' ')).join(' · '), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.primary)),
          ]),
        ),
        if (plate != null && plate.isNotEmpty)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: t.colorScheme.surface, border: Border.all(color: t.colorScheme.outline), borderRadius: BorderRadius.circular(8)),
            child: Text(plate, style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: 1)),
          ),
      ]),
    );
  }
}

/// The ride PIN, large, so it can be read out at a glance.
class PinCard extends StatelessWidget {
  const PinCard({super.key, required this.pin});
  final String pin;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Semantics(
      label: 'Ride PIN $pin. Share it with your driver to start the trip.',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(color: raastaAmber.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(16), border: Border.all(color: raastaAmber.withValues(alpha: 0.6))),
        child: Row(children: [
          const Icon(Icons.lock_outline, color: Color(0xFF9A6200)),
          const SizedBox(width: 12),
          Expanded(child: Text('Ride PIN\nTell it to your driver only when you are in the car.', style: t.textTheme.bodySmall)),
          const SizedBox(width: 8),
          Text(pin.split('').join(' '), style: t.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w900, letterSpacing: 2)),
        ]),
      ),
    );
  }
}
