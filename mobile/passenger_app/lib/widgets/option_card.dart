import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/format.dart';
import '../util/json.dart';
import 'product_icon.dart';

/// One ride category from POST /rides/quotes. [tags] are AI labels (Cheapest, Fastest, Balanced).
class OptionCard extends StatelessWidget {
  const OptionCard({super.key, required this.option, required this.selected, required this.onTap, this.tags = const []});
  final Json option;
  final bool selected;
  final VoidCallback onTap;
  final List<String> tags;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final fare = asJson(option['fare']);
    final eta = option['pickupEtaS'];
    final none = option['availability'] == 'NONE';
    final limited = option['availability'] == 'LIMITED';
    final payable = fare['payable'] ?? fare['recommended'];
    final discount = dbl(fare['discount']);
    final name = (option['name'] ?? option['productCode'] ?? 'Ride').toString();
    final code = (option['productCode'] ?? '').toString();
    final trip = option['tripEtaS'] is num ? '${etaText(option['tripEtaS'] as num)} trip' : null;
    final cap = option['capacity'] is num ? '${option['capacity']} seats' : null;
    final sub = none
        ? 'No drivers nearby. Matching may take longer.'
        : [if (eta is num) '${etaText(eta)} away' else (option['description'] ?? '').toString(), if (limited) 'Limited drivers', ?trip, ?cap].where((e) => e.isNotEmpty).join(' · ');
    return Semantics(
      selected: selected,
      button: true,
      label: '$name, ${money(payable as num?)}',
      child: Card(
        margin: const EdgeInsets.only(bottom: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: selected ? t.colorScheme.primary : t.colorScheme.outlineVariant.withValues(alpha: 0.6), width: selected ? 2 : 1)),
        color: selected ? t.colorScheme.primary.withValues(alpha: 0.07) : null,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              CircleAvatar(radius: 24, backgroundColor: t.colorScheme.primary.withValues(alpha: 0.12), child: Icon(productIcon(code, option['vehicleClass']?.toString()), color: t.colorScheme.primary)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    Text(name, style: t.textTheme.titleMedium),
                    for (final tag in tags) StatusPill(tag, color: tag == 'Cheapest' ? Colors.green.shade700 : (tag == 'Fastest' ? Colors.blue.shade700 : const Color(0xFF9A6200))),
                  ]),
                  const SizedBox(height: 2),
                  Text(sub, style: t.textTheme.bodySmall?.copyWith(color: none ? const Color(0xFF9A6200) : t.colorScheme.onSurfaceVariant)),
                ]),
              ),
              const SizedBox(width: 8),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(money(payable), style: t.textTheme.titleMedium),
                if (discount > 0) Text(money(fare['recommended'] as num?), style: t.textTheme.bodySmall?.copyWith(decoration: TextDecoration.lineThrough, color: t.colorScheme.onSurfaceVariant)),
              ]),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Maps quote.recommendations to per-product labels (Cheapest / Fastest / Balanced / Shared saver).
Map<String, List<String>> recommendationTags(Object? recs) {
  final out = <String, List<String>>{};
  for (final r in asJsonList(recs)) {
    final code = r['productCode']?.toString();
    final label = switch (r['kind']) { 'CHEAPEST' => 'Cheapest', 'FASTEST' => 'Fastest', 'BALANCED' => 'Balanced', 'SHARED' => 'Shared saver', _ => null };
    if (code == null || label == null) continue;
    out.putIfAbsent(code, () => []).add(label);
  }
  return out;
}
