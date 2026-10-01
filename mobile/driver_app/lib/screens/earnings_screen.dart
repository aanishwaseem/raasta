import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen> {
  ApiClient get api => widget.api;
  late Future<List<dynamic>> _f = _load();

  Future<List<dynamic>> _load() => Future.wait([api.get('/driver/earnings'), api.get('/driver/wallet')]);

  Future<void> _withdraw(num available) async {
    final amount = TextEditingController(text: '${available.floor()}');
    final acct = TextEditingController();
    final title = TextEditingController();
    var method = 'JAZZCASH';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('Withdraw earnings'),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Amount (Rs, min 500)')),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(initialValue: method, decoration: const InputDecoration(labelText: 'Send to'), items: [for (final m in ['JAZZCASH', 'EASYPAISA', 'BANK']) DropdownMenuItem(value: m, child: Text(m))], onChanged: (v) => set(() => method = v!)),
            const SizedBox(height: 8),
            TextField(controller: acct, decoration: const InputDecoration(labelText: 'Account number or IBAN')),
            const SizedBox(height: 8),
            TextField(controller: title, decoration: const InputDecoration(labelText: 'Account title')),
          ])),
          actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Request'))],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await api.post('/driver/withdrawals', body: {'amount': int.tryParse(amount.text) ?? 0, 'method': method, 'accountNumber': acct.text.trim(), 'accountTitle': title.text.trim()}, idempotencyKey: ApiClient.newIdempotencyKey());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Withdrawal requested. It will be paid after review.')));
        setState(() => _f = _load());
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.friendly)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Earnings')),
      body: FutureBuilder<List<dynamic>>(
        future: _f,
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
            Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: OutlinedButton(onPressed: (w['available'] as num) >= 500 ? () => _withdraw(w['available'] as num) : null, child: const Text('Withdraw'))),
            for (final n in (e['notes'] as List? ?? const [])) Padding(padding: const EdgeInsets.all(16), child: Text('$n', style: Theme.of(context).textTheme.bodySmall)),
          ]);
        },
      ),
    );
  }
}
