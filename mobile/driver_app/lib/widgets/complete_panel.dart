import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

const _ratingTags = {
  'POLITE': 'Polite',
  'RESPECTFUL': 'Respectful',
  'READY_AT_PICKUP': 'Ready at pickup',
  'KEPT_WAITING': 'Kept me waiting',
  'RUDE': 'Rude',
  'DAMAGED_VEHICLE': 'Damaged vehicle',
};

/// Trip finished: fare, cash vs wallet, then rate the passenger.
class CompletePanel extends StatefulWidget {
  const CompletePanel({super.key, required this.api, required this.ride, required this.onDone});
  final ApiClient api;
  final Map<String, dynamic> ride;
  final VoidCallback onDone;

  @override
  State<CompletePanel> createState() => _CompletePanelState();
}

class _CompletePanelState extends State<CompletePanel> {
  int _stars = 0;
  final _tags = <String>{};
  final _comment = TextEditingController();
  bool _busy = false;
  bool _rated = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _rated = widget.ride['myRating'] != null;
    _stars = (widget.ride['myRating'] as num?)?.toInt() ?? 0;
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/rides/${widget.ride['id']}/rating', body: {'stars': _stars, if (_tags.isNotEmpty) 'tags': _tags.toList(), if (_comment.text.trim().isNotEmpty) 'comment': _comment.text.trim()});
      if (mounted) setState(() => _rated = true);
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException && e.code == 'ALREADY_RATED' ? 'You already rated this trip.' : errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final fare = asMap(widget.ride['fare']);
    final amount = fare['final'] ?? fare['payable'];
    final cash = widget.ride['paymentMethod'] == 'CASH';
    final passenger = asMap(widget.ride['passenger']);
    return ListView(padding: const EdgeInsets.all(16), children: [
      const SizedBox(height: 8),
      const Icon(Icons.check_circle, color: goGreen, size: 64),
      Text('Trip complete', textAlign: TextAlign.center, style: t.textTheme.headlineMedium),
      const SizedBox(height: 16),
      Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(children: [
        Text('Fare', style: t.textTheme.labelLarge?.copyWith(color: t.colorScheme.onSurfaceVariant)),
        Text(money(amount as num?), style: t.textTheme.displayMedium?.copyWith(fontWeight: FontWeight.w900)),
        const SizedBox(height: 8),
        if (cash)
          _Pay(icon: Icons.payments, color: raastaAmber, title: 'Cash collected from rider', body: 'Collect ${money(amount)} in cash. Platform fees for cash trips are settled through your wallet.')
        else
          _Pay(icon: Icons.account_balance_wallet, color: goGreen, title: 'Paid in the app', body: 'No cash to collect. Your earnings are credited to your wallet after settlement.'),
      ]))),
      const SizedBox(height: 16),
      Text(_rated ? 'Thanks for rating' : 'Rate ${passenger['firstName'] ?? 'your rider'}', textAlign: TextAlign.center, style: t.textTheme.titleLarge),
      RatingStars(value: _stars, onChanged: _rated ? (_) {} : (v) => setState(() => _stars = v), size: 48),
      if (!_rated) ...[
        Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 4, children: [
          for (final e in _ratingTags.entries) FilterChip(label: Text(e.value), selected: _tags.contains(e.key), onSelected: (s) => setState(() => s ? _tags.add(e.key) : _tags.remove(e.key))),
        ]),
        const SizedBox(height: 12),
        TextField(controller: _comment, maxLength: 500, maxLines: 2, decoration: const InputDecoration(hintText: 'Add a comment (optional)')),
        if (_error != null) Text(_error!, style: TextStyle(color: t.colorScheme.error)),
        FilledButton(onPressed: _busy || _stars == 0 ? null : _submit, child: _busy ? const CircularProgressIndicator() : const Text('Submit rating')),
      ],
      const SizedBox(height: 12),
      _rated ? FilledButton(onPressed: widget.onDone, child: const Text('Back to driving')) : OutlinedButton(onPressed: widget.onDone, child: const Text('Skip and back to driving')),
    ]);
  }
}

class _Pay extends StatelessWidget {
  const _Pay({required this.icon, required this.color, required this.title, required this.body});
  final IconData icon;
  final Color color;
  final String title;
  final String body;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(14)),
        child: Row(children: [
          Icon(icon, color: color, size: 30),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: Theme.of(context).textTheme.titleSmall), Text(body, style: Theme.of(context).textTheme.bodySmall)])),
        ]),
      );
}
