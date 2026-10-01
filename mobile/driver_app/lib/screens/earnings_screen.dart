import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

class EarningsScreen extends StatelessWidget {
  const EarningsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Earnings')),
      body: FutureBuilder<List<dynamic>>(
        future: Future.wait([api.get('/driver/earnings'), api.get('/driver/wallet')]),
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text(snap.error is ApiException ? (snap.error as ApiException).friendly : 'Could not load earnings.'));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final e = snap.data![0] as Map<String, dynamic>;
          final w = snap.data![1] as Map<String, dynamic>;
          Widget row(String k, String v) => ListTile(title: Text(k), trailing: Text(v, style: Theme.of(context).textTheme.titleMedium));
          return ListView(children: [
            const Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 0), child: Text('Last 7 days')),
            row('Trips', '${e['trips']}'),
            row('Gross', money(e['gross'])),
            row('Platform fees', money(e['platformFees'])),
            row('Net', money(e['net'])),
            row('Fuel (estimate)', money(e['fuelEstimate'])),
            row('Distance', '${e['distanceKm']} km'),
            const Divider(),
            row('Wallet available', money(w['available'])),
            for (final n in (e['notes'] as List? ?? const [])) Padding(padding: const EdgeInsets.all(16), child: Text('$n', style: Theme.of(context).textTheme.bodySmall)),
          ]);
        },
      ),
    );
  }
}
