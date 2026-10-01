import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

/// Withdrawal request form. Validation mirrors the server rules (Rs 500 to 500,000, account 8-34 chars).
class WithdrawSheet extends StatefulWidget {
  const WithdrawSheet({super.key, required this.api, required this.available});
  final ApiClient api;
  final num available;

  @override
  State<WithdrawSheet> createState() => _WithdrawSheetState();
}

class _WithdrawSheetState extends State<WithdrawSheet> {
  final _form = GlobalKey<FormState>();
  late final _amount = TextEditingController(text: widget.available >= 500 ? '${widget.available.floor()}' : '');
  final _acct = TextEditingController();
  final _title = TextEditingController();
  String _method = 'JAZZCASH';
  bool _busy = false;
  String? _error;
  final _key = ApiClient.newIdempotencyKey();

  @override
  void dispose() {
    _amount.dispose();
    _acct.dispose();
    _title.dispose();
    super.dispose();
  }

  String? _validAmount(String? v) {
    final n = int.tryParse((v ?? '').trim());
    if (n == null) return 'Enter an amount in rupees';
    if (n < 500) return 'Minimum withdrawal is Rs 500';
    if (n > 500000) return 'Maximum withdrawal is Rs 500,000';
    if (n > widget.available) return 'You only have ${money(widget.available)} available';
    return null;
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/driver/withdrawals', body: {'amount': int.parse(_amount.text.trim()), 'method': _method, 'accountNumber': _acct.text.trim(), 'accountTitle': _title.text.trim()}, idempotencyKey: _key);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _error = errorText(e); _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.viewInsetsOf(context).bottom + 16),
      child: SingleChildScrollView(
        child: Form(
          key: _form,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Withdraw earnings', style: t.textTheme.titleLarge),
            Text('Available: ${money(widget.available)}. Requests are reviewed before payout.', style: t.textTheme.bodySmall),
            const SizedBox(height: 12),
            TextFormField(controller: _amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Amount (Rs)'), validator: _validAmount),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(initialValue: _method, decoration: const InputDecoration(labelText: 'Send to'), items: const [DropdownMenuItem(value: 'JAZZCASH', child: Text('JazzCash')), DropdownMenuItem(value: 'EASYPAISA', child: Text('Easypaisa')), DropdownMenuItem(value: 'BANK', child: Text('Bank account'))], onChanged: (v) => setState(() => _method = v!)),
            const SizedBox(height: 12),
            TextFormField(controller: _acct, decoration: InputDecoration(labelText: _method == 'BANK' ? 'IBAN' : 'Mobile wallet number'), validator: (v) => (v ?? '').trim().length < 8 || v!.trim().length > 34 ? 'Enter 8 to 34 characters' : null),
            const SizedBox(height: 12),
            TextFormField(controller: _title, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Account title'), validator: (v) => (v ?? '').trim().length < 2 ? 'Enter the account holder name' : null),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: t.colorScheme.error, fontWeight: FontWeight.w600))),
            const SizedBox(height: 16),
            FilledButton(onPressed: _busy ? null : _submit, child: _busy ? const CircularProgressIndicator() : const Text('Request withdrawal')),
          ]),
        ),
      ),
    );
  }
}
