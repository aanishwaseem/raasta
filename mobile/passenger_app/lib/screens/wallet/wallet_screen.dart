import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/load_view.dart';
import '../../widgets/sheets.dart';
import 'topup_sheet.dart';

class _WalletData {
  _WalletData(this.wallet, this.tx, this.total, this.methods, this.stats);
  final Json wallet;
  final List<Json> tx;
  final int total;
  final List<Json> methods;
  final Json stats;
}

/// Balance, top-up, transactions, promo savings and saved payment methods.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  final _view = GlobalKey<LoadViewState<_WalletData>>();
  final _more = <Json>[];
  int _page = 1;
  bool _loadingMore = false;
  bool _busy = false;

  Future<_WalletData> _load() async {
    final r = await Future.wait([
      widget.api.get('/wallet'),
      widget.api.get('/wallet/transactions', query: {'pageSize': '20'}),
      widget.api.get('/payment-methods'),
      widget.api.get('/me/stats').catchError((_) => <String, dynamic>{}),
    ]);
    _more.clear();
    _page = 1;
    return _WalletData(asJson(r[0]), pageItems(r[1]), ((r[1] as Map)['total'] as num?)?.toInt() ?? 0, asJsonList(r[2]), asJson(r[3]));
  }

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final r = await widget.api.get('/wallet/transactions', query: {'pageSize': '20', 'page': '${_page + 1}'});
      if (mounted) setState(() { _more.addAll(pageItems(r)); _page++; });
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _addCard() async {
    setState(() => _busy = true);
    try {
      // Development gateway: the API's mock provider accepts a test token. A live gateway needs its own card-entry SDK; card numbers never touch this app.
      await widget.api.post('/payment-methods', body: {'provider': 'mock', 'token': 'tok_visa'});
      await _view.currentState?.reload();
      if (mounted) toast(context, 'Test card added.');
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeCard(Json m) async {
    if (!await confirmDialog(context, title: 'Remove card?', message: '${m['brand'] ?? 'Card'} •••• ${m['last4'] ?? ''} will be removed from your account.', confirm: 'Remove', destructive: true)) return;
    try {
      await widget.api.delete('/payment-methods/${m['id']}');
      _view.currentState?.reload();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  Future<void> _topup(_WalletData d) async {
    if (d.methods.isEmpty) {
      toast(context, 'Add a card first to top up.');
      return;
    }
    final ok = await showTopupSheet(context, widget.api, d.methods);
    if (ok == true) _view.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Wallet')),
      body: LoadView<_WalletData>(key: _view, load: _load, builder: _body),
    );
  }

  List<Widget> _body(BuildContext context, _WalletData d, Future<void> Function() reload) {
    final t = Theme.of(context);
    final w = d.wallet;
    final tx = [...d.tx, ..._more];
    return [
      Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(24), gradient: LinearGradient(colors: [t.colorScheme.primary, Color.lerp(t.colorScheme.primary, raastaInk, 0.45)!], begin: Alignment.topLeft, end: Alignment.bottomRight)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Raasta wallet', style: t.textTheme.labelLarge?.copyWith(color: Colors.white70)),
          const SizedBox(height: 4),
          Text(money(w['available'] as num?), style: t.textTheme.displaySmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
          if (dbl(w['pending']) != 0) Text('${money(w['pending'] as num?)} pending', style: const TextStyle(color: Colors.white70)),
          if (dbl(w['outstanding']) > 0) Text('${money(w['outstanding'] as num?)} outstanding. It will be taken from your next top-up.', style: const TextStyle(color: Colors.white)),
          const SizedBox(height: 16),
          FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: raastaInk), onPressed: () => _topup(d), icon: const Icon(Icons.add), label: const Text('Top up')),
        ]),
      ),
      const SectionTitle('Payment methods'),
      InfoTile(icon: Icons.payments_outlined, title: 'Cash', subtitle: 'Always available. Pay your driver at the end of the trip.', trailing: const SizedBox.shrink()),
      const SizedBox(height: 8),
      for (final m in d.methods) Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(icon: Icons.credit_card, title: '${m['brand'] ?? 'Card'} •••• ${m['last4'] ?? ''}', subtitle: [if (m['isDefault'] == true) 'Default', if (m['expMonth'] != null) 'Expires ${m['expMonth']}/${m['expYear']}'].join(' · '), trailing: IconButton(tooltip: 'Remove card', icon: const Icon(Icons.delete_outline), onPressed: () => _removeCard(m)))),
      OutlinedButton.icon(onPressed: _busy ? null : _addCard, icon: const Icon(Icons.add_card), label: const Text('Add a test card')),
      const Padding(padding: EdgeInsets.fromLTRB(4, 6, 4, 0), child: Text('Development gateway: adds a test card. Real card entry arrives with the live payment provider; card numbers never touch this app.')),
      const SectionTitle('Promo credits'),
      InfoTile(icon: Icons.local_offer_outlined, title: 'Saved with promo codes: ${money(d.stats['promoSavings'] as num? ?? 0)}', subtitle: 'Enter a promo code when you book. The discount shows on your fare and receipt.', trailing: const SizedBox.shrink(), color: raastaAmber),
      const SectionTitle('Transactions'),
      if (tx.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No transactions yet. Top-ups, wallet payments and refunds will appear here.')),
      for (final x in tx) _txTile(context, x),
      if (tx.length < d.total) OutlinedButton(onPressed: _loadingMore ? null : _loadMore, child: Text(_loadingMore ? 'Loading…' : 'Load more')),
    ];
  }

  Widget _txTile(BuildContext context, Json x) {
    final amt = (x['amount'] as num?) ?? 0;
    final pos = amt >= 0;
    final t = Theme.of(context);
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(backgroundColor: (pos ? Colors.green : t.colorScheme.error).withValues(alpha: 0.12), child: Icon(pos ? Icons.south_west : Icons.north_east, size: 18, color: pos ? Colors.green.shade700 : t.colorScheme.error)),
      title: Text('${x['description'] ?? humanize('${x['kind'] ?? 'Transaction'}')}', maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(whenText(x['createdAt'])),
      trailing: Text('${pos ? '+' : '-'}${money(amt.abs())}', style: t.textTheme.titleSmall?.copyWith(color: pos ? Colors.green.shade700 : null, fontWeight: FontWeight.w700)),
    );
  }
}
