import 'package:flutter/material.dart';
import '../../util/clipboard.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/load_view.dart';
import '../../widgets/payment_picker.dart';

/// Fare receipt from GET /rides/:id/receipt.
class ReceiptScreen extends StatelessWidget {
  const ReceiptScreen({super.key, required this.api, required this.rideId});
  final ApiClient api;
  final String rideId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Receipt')),
      body: LoadView<Json>(
        load: () async => asJson(await api.get('/rides/$rideId/receipt')),
        builder: (context, r, _) => _body(context, r),
      ),
    );
  }

  List<Widget> _body(BuildContext context, Json r) {
    final t = Theme.of(context);
    final fare = asJson(r['fare']);
    final b = asJson(fare['breakdown']);
    final lines = fare['explanation'] is List ? (fare['explanation'] as List).map((e) => e.toString()).toList() : <String>[];
    Widget row(String l, Object? v, {bool negative = false, bool bold = false}) => (v is! num || (v == 0 && !bold))
        ? const SizedBox.shrink()
        : Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Row(children: [Expanded(child: Text(l, style: bold ? t.textTheme.titleSmall : null)), Text('${negative ? '-' : ''}${money(v.abs())}', style: bold ? t.textTheme.titleMedium : null)]));
    final payments = asJsonList(r['payments']);
    return [
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Total charged', style: t.textTheme.labelLarge),
        Text(money(fare['charged'] as num?), style: t.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Row(children: [Icon(paymentIcon((r['paymentMethod'] ?? 'CASH').toString()), size: 18), const SizedBox(width: 6), Text('${paymentName((r['paymentMethod'] ?? 'CASH').toString())} · ${humanize((r['paymentStatus'] ?? '').toString())}')]),
      ]))),
      const SectionTitle('Trip'),
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [const Icon(Icons.trip_origin, size: 16), const SizedBox(width: 8), Expanded(child: Text('${r['pickupAddress'] ?? ''}'))]),
        const SizedBox(height: 8),
        Row(children: [const Icon(Icons.flag, size: 16, color: raastaAmber), const SizedBox(width: 8), Expanded(child: Text('${r['dropoffAddress'] ?? ''}'))]),
        const SizedBox(height: 8),
        Text('${whenText(r['startedAt'] ?? r['completedAt'])} · ${km(r['distanceM'] as num?)}', style: t.textTheme.bodySmall),
      ]))),
      const SectionTitle('Fare breakdown'),
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [
        row('Base fare', b['base']),
        row('Distance', b['distance']),
        row('Time', b['time']),
        row('Booking fee', b['bookingFee']),
        row('Demand adjustment', b['demandAdjustment']),
        row('Shared-ride discount', b['sharedDiscount'], negative: true),
        if (b.isNotEmpty) const Divider(),
        row('Agreed fare', fare['agreed'], bold: true),
        row('Promo discount', fare['discount'], negative: true),
        row('Cancellation fee', fare['cancellationFee']),
        const Divider(),
        row('Charged', fare['charged'], bold: true),
      ]))),
      if (lines.isNotEmpty) ...[const SectionTitle('How this fare was set'), for (final l in lines) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('• $l'))],
      if (payments.isNotEmpty) ...[
        const SectionTitle('Payments'),
        for (final p in payments) Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(icon: paymentIcon((p['method'] ?? 'CASH').toString()), title: '${humanize((p['purpose'] ?? 'Payment').toString())} · ${money(p['amount'] as num?)}', subtitle: '${humanize((p['status'] ?? '').toString())} · ${whenText(p['createdAt'])}')),
      ],
      const SizedBox(height: 8),
      OutlinedButton.icon(
        onPressed: () async {
          copyText('Raasta receipt\n${r['pickupAddress']} to ${r['dropoffAddress']}\n${whenText(r['completedAt'])}\nTotal ${money(fare['charged'] as num?)} (${paymentName((r['paymentMethod'] ?? 'CASH').toString())})\nRide ${r['rideId']}');
          if (context.mounted) toast(context, 'Receipt copied.');
        },
        icon: const Icon(Icons.copy_outlined),
        label: const Text('Copy receipt'),
      ),
    ];
  }
}
