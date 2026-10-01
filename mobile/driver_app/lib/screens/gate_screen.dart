import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import 'drive_screen.dart';
import 'onboarding_screen.dart';

/// Decides what a signed-in driver sees: onboarding until approved, the safety acknowledgement, then driving.
class GateScreen extends StatefulWidget {
  const GateScreen({super.key, required this.api, required this.location, required this.onSignOut});
  final ApiClient api;
  final DeviceLocation location;
  final VoidCallback onSignOut;

  @override
  State<GateScreen> createState() => _GateScreenState();
}

class _GateScreenState extends State<GateScreen> {
  Map<String, dynamic>? _me;
  String? _error;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    try {
      final m = await widget.api.get('/driver/me') as Map<String, dynamic>;
      if (mounted) setState(() { _me = m; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    if (me == null) {
      return Scaffold(
        appBar: AppBar(actions: [IconButton(icon: const Icon(Icons.logout), tooltip: 'Sign out', onPressed: widget.onSignOut)]),
        body: Center(child: _error == null ? const CircularProgressIndicator() : Column(mainAxisSize: MainAxisSize.min, children: [Text(_error!), TextButton(onPressed: refresh, child: const Text('Retry'))])),
      );
    }
    if (me['canGoOnline'] == true) return DriveScreen(api: widget.api, location: widget.location, onSignOut: widget.onSignOut);
    if (me['status'] == 'APPROVED') return _Training(api: widget.api, onDone: refresh, onSignOut: widget.onSignOut);
    return OnboardingScreen(api: widget.api, me: me, onChanged: refresh, onSignOut: widget.onSignOut);
  }
}

class _Training extends StatefulWidget {
  const _Training({required this.api, required this.onDone, required this.onSignOut});
  final ApiClient api;
  final VoidCallback onDone;
  final VoidCallback onSignOut;

  @override
  State<_Training> createState() => _TrainingState();
}

class _TrainingState extends State<_Training> {
  bool _ack = false;
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Welcome to Raasta'), actions: [IconButton(icon: const Icon(Icons.logout), onPressed: widget.onSignOut)]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('You are approved.', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 12),
        const Text('Before your first trip, please confirm the Raasta code of conduct:'),
        const SizedBox(height: 8),
        for (final t in const ['Drive safely and follow traffic rules.', 'Treat every rider with respect. Harassment means removal.', 'Never ask a rider to cancel or pay outside the app.', 'Use the PIN to start every trip.', 'SOS and trip-sharing are there for everyone\'s safety.'])
          ListTile(dense: true, leading: const Icon(Icons.check_circle_outline), title: Text(t)),
        CheckboxListTile(value: _ack, onChanged: (v) => setState(() => _ack = v ?? false), title: const Text('I have read and agree to the code of conduct')),
        if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: !_ack || _busy ? null : () async {
            setState(() { _busy = true; _error = null; });
            try {
              await widget.api.post('/driver/onboarding/training', body: {'acknowledged': true});
              widget.onDone();
            } on ApiException catch (e) {
              setState(() => _error = e.friendly);
            } finally {
              if (mounted) setState(() => _busy = false);
            }
          },
          child: const Text('Start driving'),
        ),
      ]),
    );
  }
}
