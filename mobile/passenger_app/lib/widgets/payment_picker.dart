import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/json.dart';
import 'sheets.dart';

/// What the rider can pay with: cash always, wallet when it has balance, card when one is saved.
class PaymentInfo {
  const PaymentInfo({this.balance, this.card});
  final num? balance;
  final Json? card;

  static Future<PaymentInfo> load(ApiClient api) async {
    num? bal;
    Json? card;
    try {
      bal = asJson(await api.get('/wallet'))['available'] as num?;
    } on ApiException {/* wallet unavailable: cash still works */}
    try {
      final m = asJsonList(await api.get('/payment-methods'));
      if (m.isNotEmpty) card = m.first;
    } on ApiException {/* no cards */}
    return PaymentInfo(balance: bal, card: card);
  }

  String? cardLabel() => card == null ? null : '${card!['brand'] ?? 'Card'} •••• ${card!['last4'] ?? ''}'.trim();
}

String paymentName(String code) => switch (code) { 'WALLET' => 'Raasta wallet', 'CARD' => 'Card', 'CORPORATE' => 'Business', _ => 'Cash' };

IconData paymentIcon(String code) => switch (code) { 'WALLET' => Icons.account_balance_wallet_outlined, 'CARD' => Icons.credit_card, 'CORPORATE' => Icons.business_center_outlined, _ => Icons.payments_outlined };

/// Single row showing the chosen method; tapping opens the picker sheet.
class PaymentRow extends StatelessWidget {
  const PaymentRow({super.key, required this.method, required this.info, required this.payable, required this.onChanged});
  final String method;
  final PaymentInfo info;
  final num? payable;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () async {
        final v = await showAppSheet<String>(context, (c) => _PaymentSheet(selected: method, info: info, payable: payable));
        if (v != null) onChanged(v);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(children: [
          Icon(paymentIcon(method), color: t.colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(child: Text(method == 'CARD' ? info.cardLabel() ?? 'Card' : paymentName(method), style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700))),
          Text('Change', style: t.textTheme.labelLarge?.copyWith(color: t.colorScheme.primary)),
          const Icon(Icons.chevron_right),
        ]),
      ),
    );
  }
}

class _PaymentSheet extends StatelessWidget {
  const _PaymentSheet({required this.selected, required this.info, required this.payable});
  final String selected;
  final PaymentInfo info;
  final num? payable;

  @override
  Widget build(BuildContext context) {
    final lowWallet = info.balance != null && payable != null && info.balance! < payable!;
    Widget tile(String code, String subtitle, {bool enabled = true}) => ListTile(
          enabled: enabled,
          contentPadding: EdgeInsets.zero,
          leading: Icon(paymentIcon(code)),
          title: Text(code == 'CARD' ? info.cardLabel() ?? 'Card' : paymentName(code)),
          subtitle: Text(subtitle),
          trailing: Icon(selected == code ? Icons.radio_button_checked : Icons.radio_button_off),
          onTap: enabled ? () => Navigator.pop(context, code) : null,
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SheetTitle('Pay with'),
      tile('CASH', 'Pay your driver at the end of the trip'),
      tile('WALLET', info.balance == null ? 'Wallet unavailable right now' : (lowWallet ? 'Balance ${money(info.balance)} is lower than this fare. Top up in Wallet.' : 'Balance ${money(info.balance)}'), enabled: info.balance != null && !lowWallet),
      tile('CARD', info.card == null ? 'Add a card in the Wallet tab first' : 'Saved card (development gateway)', enabled: info.card != null),
    ]);
  }
}
