import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../widgets/sheets.dart';

Future<bool?> showTopupSheet(BuildContext context, ApiClient api, List<Json> methods) => showAppSheet<bool>(context, (c) => TopupSheet(api: api, methods: methods));

class TopupSheet extends StatefulWidget {
  const TopupSheet({super.key, required this.api, required this.methods});
  final ApiClient api;
  final List<Json> methods;
  @override
  State<TopupSheet> createState() => _TopupSheetState();
}

class _TopupSheetState extends State<TopupSheet> {
  final _custom = TextEditingController();
  int? _amount = 1000;
  late String _method = widget.methods.first['id'] as String;
  bool _busy = false;
  String? _error;
  final _key = ApiClient.newIdempotencyKey();

  @override
  void dispose() {
    _custom.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    final amount = _custom.text.trim().isNotEmpty ? int.tryParse(_custom.text.trim()) : _amount;
    if (amount == null || amount < 100 || amount > 50000) {
      setState(() => _error = 'Enter an amount between Rs 100 and Rs 50,000.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/wallet/topups', body: {'amount': amount, 'paymentMethodId': _method}, idempotencyKey: _key);
      if (!mounted) return;
      toast(context, '${money(amount)} added to your wallet.');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SheetTitle('Top up wallet', subtitle: 'Choose an amount. Your wallet can pay for rides and is never charged without you choosing wallet at checkout.'),
      Wrap(spacing: 8, runSpacing: 8, children: [for (final a in [500, 1000, 2000, 5000]) ChoiceChip(label: Text(money(a)), selected: _custom.text.isEmpty && _amount == a, onSelected: (_) => setState(() { _amount = a; _custom.clear(); }))]),
      const SizedBox(height: 12),
      TextField(controller: _custom, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'Other amount (Rs)', prefixIcon: Icon(Icons.edit_outlined))),
      if (widget.methods.length > 1) ...[
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: _method, decoration: const InputDecoration(labelText: 'Pay with'), items: [for (final m in widget.methods) DropdownMenuItem(value: m['id'] as String, child: Text('${m['brand'] ?? 'Card'} •••• ${m['last4'] ?? ''}'))], onChanged: (v) => setState(() => _method = v ?? _method)),
      ] else
        Padding(padding: const EdgeInsets.only(top: 12), child: Text('Paying with ${widget.methods.first['brand'] ?? 'Card'} •••• ${widget.methods.first['last4'] ?? ''}')),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      const SizedBox(height: 16),
      FilledButton(onPressed: _busy ? null : _go, child: Text(_busy ? 'Adding…' : 'Add money')),
    ]);
  }
}
