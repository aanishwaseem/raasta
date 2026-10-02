import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../widgets/driver_card.dart';

const _good = {'SAFE_DRIVING': 'Safe driving', 'CLEAN_VEHICLE': 'Clean car', 'POLITE': 'Polite', 'ON_TIME': 'On time', 'GOOD_NAVIGATION': 'Good navigation', 'RESPECTFUL': 'Respectful'};
const _bad = {'RASH_DRIVING': 'Rash driving', 'RUDE': 'Rude', 'LATE': 'Late', 'DIRTY_VEHICLE': 'Dirty car', 'WRONG_ROUTE': 'Wrong route', 'FELT_UNSAFE': 'Felt unsafe'};

/// Rate the driver: stars, reason tags that fit the score, and an optional comment. Pops `true` when submitted.
class RatingScreen extends StatefulWidget {
  const RatingScreen({super.key, required this.api, required this.rideId, this.driver});
  final ApiClient api;
  final String rideId;
  final Json? driver;
  @override
  State<RatingScreen> createState() => _RatingScreenState();
}

class _RatingScreenState extends State<RatingScreen> {
  int _stars = 0;
  final _tags = <String>{};
  final _comment = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/rides/${widget.rideId}/rating', body: {'stars': _stars, if (_tags.isNotEmpty) 'tags': _tags.toList(), if (_comment.text.trim().isNotEmpty) 'comment': _comment.text.trim()});
      if (!mounted) return;
      toast(context, 'Thanks for your feedback.');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
      // Already rated: nothing more to do here.
      if (e.code == 'ALREADY_RATED' && mounted) Navigator.pop(context, true);
    }
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final options = _stars == 0 ? const <String, String>{} : (_stars >= 4 ? _good : {..._bad, ..._good});
    return Scaffold(
      appBar: AppBar(title: const Text('Rate your trip')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (widget.driver != null) DriverCard(driver: widget.driver!),
        const SizedBox(height: 24),
        Text('How was your ride?', textAlign: TextAlign.center, style: t.textTheme.titleLarge),
        RatingStars(value: _stars, onChanged: (v) => setState(() { _stars = v; _tags.clear(); })),
        if (_stars > 0) ...[
          Text(_stars >= 4 ? 'What went well?' : 'What could be better?', style: t.textTheme.titleSmall),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final e in options.entries) FilterChip(label: Text(e.value), selected: _tags.contains(e.key), onSelected: (s) => setState(() => s ? (_tags.length < 6 ? _tags.add(e.key) : null) : _tags.remove(e.key))),
          ]),
          const SizedBox(height: 16),
          TextField(controller: _comment, maxLines: 3, maxLength: 500, decoration: const InputDecoration(labelText: 'Comment (optional)')),
          if (_tags.contains('FELT_UNSAFE')) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text('Your safety report goes to our safety team for review.', style: t.textTheme.bodySmall)),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: t.colorScheme.error))),
        FilledButton(onPressed: _stars == 0 || _busy ? null : _submit, child: const Text('Submit rating')),
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Skip for now')),
      ]),
    );
  }
}
