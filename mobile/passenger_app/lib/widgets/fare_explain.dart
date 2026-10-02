import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/format.dart';
import '../util/json.dart';

/// "Why this fare?" panel: shows the server's own explanation and fare breakdown, nothing invented on the device.
class FareExplain extends StatelessWidget {
  const FareExplain({super.key, required this.option, this.recommendations = const []});
  final Json option;
  final List<Json> recommendations;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final fare = asJson(option['fare']);
    final b = asJson(fare['breakdown']);
    final lines = (fare['explanation'] is List ? (fare['explanation'] as List).map((e) => e.toString()).toList() : <String>[]);
    final reasons = [
      for (final r in recommendations)
        if (r['productCode'] == option['productCode'] && r['reasons'] is List) ...(r['reasons'] as List).map((e) => e.toString()),
    ];
    final match = asJson(fare['expectedMatchSeconds'])['atRecommended'];
    Widget row(String l, num? v, {bool negative = false}) => (v == null || v == 0)
        ? const SizedBox.shrink()
        : Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(children: [Expanded(child: Text(l)), Text('${negative ? '-' : ''}${money(v.abs())}')]));
    return Theme(
      data: t.copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        leading: Icon(Icons.auto_awesome_outlined, color: t.colorScheme.primary),
        title: Text('Why ${money(fare['recommended'] as num?)}?', style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
        subtitle: Text('Fair range ${money(fare['low'] as num?)} to ${money(fare['high'] as num?)}'),
        childrenPadding: const EdgeInsets.only(bottom: 8),
        children: [
          for (final l in [...lines, ...reasons]) Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('• '), Expanded(child: Text(l))])),
          if (match is num) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('Expected time to find a driver at this fare: about ${etaText(match)}.', style: t.textTheme.bodySmall)),
          const Divider(),
          row('Base fare', b['base'] as num?),
          row('Distance', b['distance'] as num?),
          row('Time', b['time'] as num?),
          row('Minimum fare top-up', b['minimumFareAdjustment'] as num?),
          row('Booking fee', b['bookingFee'] as num?),
          row('Demand adjustment', b['demandAdjustment'] as num?),
          row('Shared-ride discount', b['sharedDiscount'] as num?, negative: true),
          row('Promo discount', fare['discount'] as num?, negative: true),
        ],
      ),
    );
  }
}
