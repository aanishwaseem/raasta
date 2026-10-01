import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Map<String, dynamic>? _wallet;
  List<Map<String, dynamic>> _tx = [];
  List<Map<String, dynamic>> _methods = [];
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([widget.api.get('/wallet'), widget.api.get('/wallet/transactions', query: {'pageSize': '20'}), widget.api.get('/payment-methods')]);
      if (!mounted) return;
      setState(() {
        _wallet = r[0] as Map<String, dynamic>;
        _tx = ((r[1] as Map)['items'] as List).cast<Map<String, dynamic>>();
        _methods = (r[2] as List).cast<Map<String, dynamic>>();
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    }
  }

  Future<void> _addCard() async {
    // Development provider: the API's mock gateway accepts a test token. A live gateway needs its own card-entry SDK; card numbers never touch this app.
    setState(() => _busy = true);
    try {
      await widget.api.post('/payment-methods', body: {'provider': 'mock', 'token': 'tok_visa'});
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _topup(int amount) async {
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/wallet/topups', body: {'amount': amount, 'paymentMethodId': _methods.first['id']}, idempotencyKey: ApiClient.newIdempotencyKey());
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = _wallet;
    return Scaffold(
      appBar: AppBar(title: const Text('Wallet')),
      body: w == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Available balance'),
                  Text(money(w['available']), style: Theme.of(context).textTheme.displaySmall),
                  if ((w['pending'] ?? 0) != 0) Text('${money(w['pending'])} pending'),
                ]))),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                const SizedBox(height: 12),
                if (_methods.isEmpty)
                  FilledButton(onPressed: _busy ? null : _addCard, child: const Text('Add a test card to top up'))
                else ...[
                  Text('Top up with ${_methods.first['brand']} •••• ${_methods.first['last4']}'),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, children: [for (final a in [500, 1000, 2000, 5000]) OutlinedButton(style: OutlinedButton.styleFrom(minimumSize: const Size(96, 44)), onPressed: _busy ? null : () => _topup(a), child: Text(money(a)))]),
                ],
                const SizedBox(height: 20),
                Text('Recent activity', style: Theme.of(context).textTheme.titleMedium),
                if (_tx.isEmpty) const Padding(padding: EdgeInsets.all(12), child: Text('No transactions yet.')),
                for (final t in _tx)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${t['description']}'),
                    subtitle: Text((t['createdAt'] as String).substring(0, 16).replaceFirst('T', ' ')),
                    trailing: Text('${(t['amount'] as num) >= 0 ? '+' : '-'}${money((t['amount'] as num).abs())}', style: TextStyle(color: (t['amount'] as num) >= 0 ? Colors.green.shade700 : null)),
                  ),
              ]),
            ),
    );
  }
}
