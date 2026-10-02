import 'package:flutter/material.dart';

import 'api_client.dart';
import 'notifications.dart' show timeAgo;
import 'widgets.dart';

/// Signed-in devices: see where the account is open and sign a device out remotely (lost phone, shared phone).
class SessionsScreen extends StatefulWidget {
  const SessionsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = _items.isEmpty; _error = null; });
    try {
      final r = await widget.api.get('/auth/sessions') as List;
      if (mounted) setState(() { _items = r.map((e) => Map<String, dynamic>.from(e as Map)).toList(); _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.friendly; _loading = false; });
    }
  }

  Future<void> _revoke(Map<String, dynamic> s) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out this device?'),
        content: Text('${s['deviceName'] ?? 'This device'} will need to sign in again.'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out'))],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.delete('/auth/sessions/${s['id']}');
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.friendly)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Signed-in devices')),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(16), child: SkeletonList(count: 3))
          : _error != null
              ? ErrorState(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
                    for (final s in _items)
                      InfoTile(
                        icon: s['platform'] == 'ios' || s['platform'] == 'android' ? Icons.smartphone : Icons.computer,
                        title: '${s['deviceName'] ?? s['platform'] ?? 'Device'}${s['current'] == true ? '  (this device)' : ''}',
                        subtitle: 'Last used ${DateTime.tryParse('${s['lastUsedAt']}') == null ? 'recently' : timeAgo(DateTime.parse('${s['lastUsedAt']}').toLocal())}',
                        trailing: s['current'] == true ? null : IconButton(tooltip: 'Sign out this device', icon: const Icon(Icons.logout), onPressed: () => _revoke(s)),
                      ),
                  ]),
                ),
    );
  }
}
