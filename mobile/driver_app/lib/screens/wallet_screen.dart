import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import '../widgets/withdraw_sheet.dart';

/// Balance (available vs pending), transaction history and withdrawal requests.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Future<Map<String, dynamic>> _load() async {
    final r = await Future.wait<dynamic>([widget.api.get('/driver/wallet'), widget.api.get('/driver/wallet/transactions', query: {'page': '1', 'pageSize': '50'})]);
    return {'wallet': asMap(r[0]), 'tx': asList(asMap(r[1])['items'])};
  }

  Future<void> _withdraw(num available, Future<void> Function() refresh) async {
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => WithdrawSheet(api: widget.api, available: available));
    if (ok == true && mounted) {
      toast(context, 'Withdrawal requested. It will be paid after review.');
      await refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Wallet')),
      body: AsyncBody<Map<String, dynamic>>(load: _load, builder: (context, data, refresh) {
        final w = asMap(data['wallet']);
        final tx = data['tx'] as List<Map<String, dynamic>>;
        final available = dbl(w['available']), pending = dbl(w['pending']), owed = dbl(w['outstanding']);
        final t = Theme.of(context);
        return RefreshIndicator(
          onRefresh: refresh,
          child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
            Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Available balance', style: t.textTheme.labelLarge?.copyWith(color: t.colorScheme.onSurfaceVariant)),
              Text(money(available), style: t.textTheme.displayMedium?.copyWith(fontWeight: FontWeight.w900, color: available < 0 ? sosRed : goGreen)),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: _Mini(label: 'Pending', value: money(pending), hint: 'Clears after settlement')),
                Expanded(child: _Mini(label: 'Completed', value: money(available), hint: 'Ready to withdraw')),
              ]),
              if (owed > 0) Padding(padding: const EdgeInsets.only(top: 12), child: StatusPill('You owe ${money(owed)}. It is deducted from future earnings.', color: raastaAmber)),
              const SizedBox(height: 16),
              FilledButton.icon(onPressed: available >= 500 ? () => _withdraw(available, refresh) : () => toast(context, 'You can withdraw once your available balance reaches Rs 500.'), icon: const Icon(Icons.arrow_upward), label: const Text('Withdraw')),
            ]))),
            const SectionTitle('Transactions'),
            if (tx.isEmpty) const EmptyState(icon: Icons.receipt_long_outlined, title: 'No transactions yet', message: 'Trip earnings, fees and payouts will be listed here.'),
            for (final e in tx) Padding(padding: const EdgeInsets.only(bottom: 8), child: _TxTile(tx: e)),
          ]),
        );
      }),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini({required this.label, required this.value, required this.hint});
  final String label;
  final String value;
  final String hint;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: t.textTheme.labelMedium), Text(value, style: t.textTheme.titleLarge), Text(hint, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant))]);
  }
}

class _TxTile extends StatelessWidget {
  const _TxTile({required this.tx});
  final Map<String, dynamic> tx;
  @override
  Widget build(BuildContext context) {
    final amount = dbl(tx['amount']);
    final d = when(tx['createdAt']);
    final pending = '${tx['bucket']}' == 'PENDING';
    final title = '${tx['description'] ?? prettyStatus('${tx['kind'] ?? 'TRANSACTION'}')}';
    return InfoTile(
      icon: amount >= 0 ? Icons.south_west : Icons.north_east,
      color: amount >= 0 ? goGreen : raastaAmber,
      title: title,
      subtitle: [if (d != null) '${dayLabel(d)} ${clock(d)}', prettyStatus('${tx['kind'] ?? ''}'.isEmpty ? 'OTHER' : '${tx['kind']}')].join(' · '),
      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [Text('${amount >= 0 ? '+' : '–'} ${money(amount.abs())}', style: Theme.of(context).textTheme.titleSmall?.copyWith(color: amount >= 0 ? goGreen : raastaAmber)), if (pending) const StatusPill('Pending', color: raastaAmber)]),
    );
  }
}
