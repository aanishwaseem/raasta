import 'dart:async';

import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import 'onboarding_screen.dart';
import 'shell_screen.dart';

/// Decides what a signed-in driver sees: onboarding (incl. review, rejection and training) until
/// the account can go online, then the five-tab app.
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
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    refresh();
    // while the application is in review, check for a decision every 30 seconds
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_me?['status'] == 'PENDING_REVIEW') refresh();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    try {
      final m = asMap(await widget.api.get('/driver/me'));
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
        body: _error == null ? const Padding(padding: EdgeInsets.all(16), child: SkeletonList(count: 5)) : ErrorState(message: _error!, onRetry: refresh),
      );
    }
    if (me['canGoOnline'] == true) return ShellScreen(api: widget.api, location: widget.location, onSignOut: widget.onSignOut);
    return OnboardingScreen(api: widget.api, me: me, onChanged: refresh, onSignOut: widget.onSignOut);
  }
}
