import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

const _conduct = [
  'Drive safely and follow traffic rules.',
  'Treat every rider with respect. Harassment means removal.',
  'Never ask a rider to cancel or pay outside the app.',
  'Use the Ride PIN to start every trip.',
  'SOS and trip sharing are there for everyone\'s safety.',
];

/// Final onboarding step: acknowledge the code of conduct, which activates the account.
class TrainingCard extends StatefulWidget {
  const TrainingCard({super.key, required this.api, required this.onDone});
  final ApiClient api;
  final Future<void> Function() onDone;
  @override
  State<TrainingCard> createState() => _TrainingCardState();
}

class _TrainingCardState extends State<TrainingCard> {
  bool _ack = false;
  bool _busy = false;
  String? _error;

  Future<void> _go() async {
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/driver/onboarding/training', body: {'acknowledged': true});
      await widget.onDone();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [const Icon(Icons.verified, color: goGreen), const SizedBox(width: 8), Expanded(child: Text('You are approved', style: t.textTheme.titleLarge))]),
      const SizedBox(height: 8),
      Text('One last step. Confirm the Raasta code of conduct to start driving:', style: t.textTheme.bodyLarge),
      const SizedBox(height: 8),
      for (final c in _conduct) Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Icon(Icons.check_circle_outline, size: 20), const SizedBox(width: 8), Expanded(child: Text(c))])),
      CheckboxListTile(contentPadding: EdgeInsets.zero, value: _ack, onChanged: (v) => setState(() => _ack = v ?? false), title: const Text('I have read and agree to the code of conduct')),
      if (_error != null) Text(_error!, style: TextStyle(color: t.colorScheme.error)),
      const SizedBox(height: 8),
      FilledButton(onPressed: !_ack || _busy ? null : _go, child: _busy ? const CircularProgressIndicator() : const Text('Start driving')),
    ])));
  }
}
