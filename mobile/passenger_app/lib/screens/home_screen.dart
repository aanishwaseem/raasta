import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import 'history_screen.dart';
import 'place_field.dart';
import 'trip_screen.dart';

/// Pickup defaults to a fixed point in Lahore until device GPS is wired in (see mobile/README.md).
const _defaultPickup = Place('Liberty Market', 'Liberty Market, Gulberg III, Lahore', 31.5102, 74.3441);

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.onSignOut});
  final ApiClient api;
  final VoidCallback onSignOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Place _pickup = _defaultPickup;
  Place? _dropoff;
  Map<String, dynamic>? _quote;
  String? _product;
  String _payment = 'CASH';
  String? _error;
  bool _busy = false;
  String? _requestKey;

  @override
  void initState() {
    super.initState();
    _resumeActive();
  }

  Future<void> _resumeActive() async {
    try {
      final a = await widget.api.get('/rides/active');
      if (a is Map && a['id'] != null && mounted) _openTrip(a['id'] as String);
    } on ApiException {/* nothing to resume */}
  }

  void _openTrip(String id) => Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, rideId: id)));

  Future<void> _getQuote() async {
    if (_dropoff == null) return;
    setState(() { _busy = true; _error = null; _quote = null; _requestKey = null; });
    try {
      final q = await widget.api.post('/rides/quotes', body: {'pickup': _pickup.toRequest(), 'dropoff': _dropoff!.toRequest()}) as Map<String, dynamic>;
      final opts = (q['options'] as List).cast<Map<String, dynamic>>();
      setState(() { _quote = q; _product = opts.isEmpty ? null : opts.first['productCode'] as String; });
    } on ApiException catch (e) {
      setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _request() async {
    setState(() { _busy = true; _error = null; });
    // Same key for retries of this tap, so a flaky connection can't create two rides.
    _requestKey ??= ApiClient.newIdempotencyKey();
    try {
      final ride = await widget.api.post('/rides', body: {'quoteId': _quote!['id'], 'productCode': _product, 'paymentMethod': _payment}, idempotencyKey: _requestKey) as Map<String, dynamic>;
      _requestKey = null;
      if (mounted) _openTrip(ride['id'] as String);
    } on ApiException catch (e) {
      setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final opts = (_quote?['options'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
    return Scaffold(
      appBar: AppBar(title: const Text('Raasta'), actions: [
        IconButton(tooltip: 'Activity', icon: const Icon(Icons.history), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => HistoryScreen(api: widget.api)))),
        IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: widget.onSignOut),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('Hi ${widget.api.session?.name.split(' ').first ?? ''}, where to?', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        PlaceField(api: widget.api, label: 'Pickup', icon: Icons.trip_origin, initial: _defaultPickup, onPicked: (p) => setState(() { _pickup = p; _quote = null; })),
        const SizedBox(height: 8),
        PlaceField(api: widget.api, label: 'Where to?', icon: Icons.flag_outlined, onPicked: (p) => setState(() { _dropoff = p; _quote = null; })),
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy || _dropoff == null ? null : _getQuote, child: const Text('See fares')),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        if (_quote != null) ...[
          const SizedBox(height: 16),
          Text('${km(_quote!['distanceM'])} · ${minutes(_quote!['durationS'])}', style: Theme.of(context).textTheme.labelLarge),
          for (final o in opts) _OptionCard(o: o, selected: o['productCode'] == _product, onTap: () => setState(() => _product = o['productCode'] as String)),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'CASH', label: Text('Cash')), ButtonSegment(value: 'WALLET', label: Text('Wallet'))],
            selected: {_payment},
            onSelectionChanged: (s) => setState(() => _payment = s.first),
          ),
          const SizedBox(height: 12),
          FilledButton(onPressed: _busy || _product == null ? null : _request, child: Text('Request ${_product ?? ''}')),
        ],
      ]),
    );
  }
}

class _OptionCard extends StatelessWidget {
  const _OptionCard({required this.o, required this.selected, required this.onTap});
  final Map<String, dynamic> o;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fare = o['fare'] as Map<String, dynamic>;
    final eta = o['pickupEtaS'];
    final none = o['availability'] == 'NONE';
    return Card(
      color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
      child: ListTile(
        onTap: onTap,
        title: Text(o['name'] as String),
        subtitle: Text(none ? 'No drivers nearby right now, matching may take longer' : (eta == null ? o['description'] as String : '${minutes(eta)} away')),
        trailing: Text(money(fare['payable'] ?? fare['recommended']), style: Theme.of(context).textTheme.titleMedium),
      ),
    );
  }
}
