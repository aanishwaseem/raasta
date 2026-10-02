import 'dart:async';

import 'package:flutter/material.dart';

import 'api_client.dart';
import 'widgets.dart';

/// Icon for a notification type coming from the backend (`RIDE_*`, `SAFETY_*`, `PAYMENT_*`, ...).
IconData notificationIcon(String type) {
  if (type.startsWith('SAFETY') || type.startsWith('SOS')) return Icons.shield_outlined;
  if (type.startsWith('PAYMENT') || type.startsWith('WALLET') || type.startsWith('WITHDRAWAL')) return Icons.account_balance_wallet_outlined;
  if (type.startsWith('DELIVERY')) return Icons.local_shipping_outlined;
  if (type.startsWith('DRIVER') || type.startsWith('DOCUMENT')) return Icons.badge_outlined;
  if (type.startsWith('RIDE')) return Icons.directions_car_outlined;
  return Icons.notifications_none;
}

/// "5 min ago" style label; falls back to a date after a week.
String timeAgo(DateTime then, {DateTime? now}) {
  final d = (now ?? DateTime.now()).difference(then);
  if (d.inMinutes < 1) return 'Just now';
  if (d.inMinutes < 60) return '${d.inMinutes} min ago';
  if (d.inHours < 24) return '${d.inHours} h ago';
  if (d.inDays < 7) return '${d.inDays} d ago';
  return '${then.day}/${then.month}/${then.year}';
}

/// In-app notification centre: everything the backend sent (also delivered as push when a push provider is configured).
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = _items.isEmpty; _error = null; });
    try {
      final r = await widget.api.get('/me/notifications', query: {'pageSize': '50'}) as Map;
      if (!mounted) return;
      setState(() {
        _items = (r['items'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _unread = (r['unread'] as num?)?.toInt() ?? 0;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.friendly; _loading = false; });
    }
  }

  Future<void> _open(Map<String, dynamic> n) async {
    if (n['readAt'] != null) return;
    setState(() { n['readAt'] = DateTime.now().toIso8601String(); _unread = (_unread - 1).clamp(0, 1 << 30); });
    try { await widget.api.post('/me/notifications/${n['id']}/read'); } on ApiException { /* shown as read; next refresh corrects it */ }
  }

  Future<void> _readAll() async {
    try {
      await widget.api.post('/me/notifications/read-all');
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.friendly)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [if (_unread > 0) TextButton(onPressed: _readAll, child: const Text('Mark all read'))]),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(16), child: SkeletonList())
          : _error != null
              ? ErrorState(message: _error!, onRetry: _load)
              : _items.isEmpty
                  ? const EmptyState(icon: Icons.notifications_none, title: 'Nothing here yet', message: 'Ride updates, receipts and safety messages will show up here.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                        itemCount: _items.length,
                        itemBuilder: (_, i) {
                          final n = _items[i];
                          final unread = n['readAt'] == null;
                          final at = DateTime.tryParse('${n['createdAt']}')?.toLocal();
                          return InfoTile(
                            icon: notificationIcon('${n['type']}'),
                            title: '${n['title']}',
                            subtitle: '${n['body']}${at == null ? '' : '\n${timeAgo(at)}'}',
                            trailing: unread ? Icon(Icons.circle, size: 10, color: Theme.of(context).colorScheme.primary, semanticLabel: 'Unread') : null,
                            onTap: () => _open(n),
                          );
                        },
                      ),
                    ),
    );
  }
}

/// App-bar bell with an unread badge. Refreshes on open, on return from the centre, and every minute.
class NotificationBell extends StatefulWidget {
  const NotificationBell({super.key, required this.api});
  final ApiClient api;

  @override
  State<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<NotificationBell> {
  int _unread = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final r = await widget.api.get('/me/notifications', query: {'pageSize': '1'}) as Map;
      if (mounted) setState(() => _unread = (r['unread'] as num?)?.toInt() ?? 0);
    } on Exception { /* the bell is decoration; stay quiet when offline */ }
  }

  @override
  Widget build(BuildContext context) {
    return IconButton.filledTonal(
      tooltip: _unread > 0 ? 'Notifications, $_unread unread' : 'Notifications',
      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
      onPressed: () async {
        await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => NotificationsScreen(api: widget.api)));
        _refresh();
      },
      icon: Badge(isLabelVisible: _unread > 0, label: Text(_unread > 9 ? '9+' : '$_unread'), child: const Icon(Icons.notifications_none)),
    );
  }
}
