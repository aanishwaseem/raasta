import 'package:flutter/material.dart';

import '../../util/format.dart';
import '../../util/json.dart';

class ChatMsg {
  ChatMsg(this.text, {this.fromUser = false, this.pending, this.parsed, this.options = const [], this.openSafety = false, this.error = false});
  final String text;
  final bool fromUser;
  final bool error;
  final Json? pending;
  final Json? parsed;
  final List<Json> options;
  final bool openSafety;
  bool resolved = false;
}

class Bubble extends StatelessWidget {
  const Bubble({super.key, required this.msg});
  final ChatMsg msg;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final me = msg.fromUser;
    return Align(
      alignment: me ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: me ? t.colorScheme.primary : (msg.error ? t.colorScheme.error.withValues(alpha: 0.12) : t.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6)),
          borderRadius: BorderRadius.only(topLeft: const Radius.circular(18), topRight: const Radius.circular(18), bottomLeft: Radius.circular(me ? 18 : 4), bottomRight: Radius.circular(me ? 4 : 18)),
        ),
        child: Text(msg.text, textDirection: _rtl(msg.text) ? TextDirection.rtl : null, style: t.textTheme.bodyMedium?.copyWith(color: me ? t.colorScheme.onPrimary : null)),
      ),
    );
  }

  bool _rtl(String s) => RegExp(r'[؀-ۿ]').hasMatch(s);
}

/// What the voice parser understood. Shown before anything can be confirmed.
class UnderstoodCard extends StatelessWidget {
  const UnderstoodCard({super.key, required this.parsed});
  final Json parsed;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    Widget row(IconData i, String label, String? v) => v == null ? const SizedBox.shrink() : Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [Icon(i, size: 18, color: t.colorScheme.primary), const SizedBox(width: 8), Text('$label  ', style: t.textTheme.bodySmall), Expanded(child: Text(v, style: t.textTheme.titleSmall, overflow: TextOverflow.ellipsis))]));
    final p = parsed['pickup'], d = parsed['dropoff'];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Here is what I understood', style: t.textTheme.labelLarge),
          row(Icons.trip_origin, 'From', p is Map ? shortAddress(p['address']) : null),
          row(Icons.flag, 'To', d is Map ? shortAddress(d['address']) : null),
          row(Icons.schedule, 'When', parsed['when'] != null ? whenText(parsed['when']) : null),
          row(Icons.directions_car_outlined, 'Ride', parsed['productCode']?.toString()),
          if (parsed['missing'] is List && (parsed['missing'] as List).isNotEmpty) row(Icons.help_outline, 'Still needed', (parsed['missing'] as List).join(', ')),
        ]),
      ),
    );
  }
}

/// Explicit confirmation for anything that books, schedules or cancels. Nothing happens until Confirm is tapped.
class ConfirmCard extends StatefulWidget {
  const ConfirmCard({super.key, required this.pending, required this.onConfirm, required this.onDismiss, required this.disabled});
  final Json pending;
  final Future<void> Function(String? paymentMethod) onConfirm;
  final VoidCallback onDismiss;
  final bool disabled;
  @override
  State<ConfirmCard> createState() => _ConfirmCardState();
}

class _ConfirmCardState extends State<ConfirmCard> {
  String? _pay;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final type = widget.pending['type']?.toString();
    final label = switch (type) { 'CANCEL_RIDE' => 'Cancel ride', 'SCHEDULE_RIDE' => 'Confirm and schedule', _ => 'Confirm and book' };
    final mins = ((widget.pending['expiresInS'] as num?) ?? 600) ~/ 60;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: t.colorScheme.primary, width: 1.5)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Icon(Icons.verified_user_outlined, color: t.colorScheme.primary), const SizedBox(width: 8), Expanded(child: Text('Please confirm', style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)))]),
          const SizedBox(height: 8),
          Text('${widget.pending['summary'] ?? ''}'),
          if (type != 'CANCEL_RIDE') ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              for (final p in const [(null, 'As suggested'), ('CASH', 'Cash'), ('WALLET', 'Wallet'), ('CARD', 'Card')])
                ChoiceChip(label: Text(p.$2), selected: _pay == p.$1, onSelected: widget.disabled ? null : (_) => setState(() => _pay = p.$1)),
            ]),
          ],
          const SizedBox(height: 4),
          Text('Nothing is booked until you confirm. Expires in $mins min.', style: t.textTheme.bodySmall),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(flex: 2, child: OutlinedButton(onPressed: widget.disabled || _busy ? null : widget.onDismiss, child: const FittedBox(child: Text('Not now')))),
            const SizedBox(width: 8),
            Expanded(flex: 3, child: FilledButton(onPressed: widget.disabled || _busy ? null : () async { setState(() => _busy = true); await widget.onConfirm(_pay); if (mounted) setState(() => _busy = false); }, child: Text(label))),
          ]),
        ]),
      ),
    );
  }
}
