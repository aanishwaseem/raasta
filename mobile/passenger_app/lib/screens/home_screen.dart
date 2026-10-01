import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import 'history_screen.dart';
import 'safety_screen.dart';
import 'wallet_screen.dart';
import 'place_field.dart';
import 'trip_screen.dart';


class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.location, required this.onSignOut});
  final ApiClient api;
  final DeviceLocation location;
  final VoidCallback onSignOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final _loc = widget.location;
  Place? _pickup;
  String? _locNote;
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
    _locate();
  }

  /// Pickup starts at the device location (reverse-geocoded to a name); falls back to the city centre with a note.
  Future<void> _locate() async {
    final f = await _loc.current();
    var name = 'Current location';
    var address = 'Current location';
    try {
      final r = await widget.api.get('/places/reverse', query: {'lat': '${f.lat}', 'lng': '${f.lng}'});
      if (r is Map) {
        name = (r['name'] ?? name) as String;
        address = (r['address'] ?? name) as String;
      }
    } on ApiException {/* keep generic label */}
    if (!mounted) return;
    setState(() {
      _pickup = Place(f.approximate ? 'City centre' : name, f.approximate ? 'City centre' : address, f.lat, f.lng);
      _locNote = f.approximate ? '${_loc.lastProblem ?? 'Using an approximate location.'} Search for your pickup below.' : null;
      _quote = null;
    });
  }

  Future<void> _resumeActive() async {
    try {
      final a = await widget.api.get('/rides/active');
      if (a is Map && a['id'] != null && mounted) _openTrip(a['id'] as String);
    } on ApiException {/* nothing to resume */}
  }

  void _openTrip(String id) => Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, rideId: id)));

  Future<void> _getQuote() async {
    if (_dropoff == null || _pickup == null) return;
    setState(() { _busy = true; _error = null; _quote = null; _requestKey = null; });
    try {
      final q = await widget.api.post('/rides/quotes', body: {'pickup': _pickup!.toRequest(), 'dropoff': _dropoff!.toRequest()}) as Map<String, dynamic>;
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
        IconButton(tooltip: 'Wallet', icon: const Icon(Icons.account_balance_wallet_outlined), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => WalletScreen(api: widget.api)))),
        IconButton(tooltip: 'Safety', icon: const Icon(Icons.shield_outlined), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SafetyScreen(api: widget.api)))),
        IconButton(tooltip: 'Activity', icon: const Icon(Icons.history), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => HistoryScreen(api: widget.api)))),
        IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: widget.onSignOut),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('Hi ${widget.api.session?.name.split(' ').first ?? ''}, where to?', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 12),
        if (_pickup != null)
          MapView(height: 200, pins: [MapPin(_pickup!.lat, _pickup!.lng, icon: Icons.my_location, label: 'Pickup'), if (_dropoff != null) MapPin(_dropoff!.lat, _dropoff!.lng, icon: Icons.flag, color: raastaAmber, label: 'Drop-off')], route: [if (_quote != null) ...((_quote!['route'] as List?) ?? const []).map((e) => [(e[0] as num).toDouble(), (e[1] as num).toDouble()])])
        else
          const SizedBox(height: 200, child: Center(child: CircularProgressIndicator())),
        if (_locNote != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_locNote!, style: Theme.of(context).textTheme.bodySmall)),
        const SizedBox(height: 12),
        PlaceField(key: ValueKey(_pickup?.name), api: widget.api, label: 'Pickup', icon: Icons.trip_origin, initial: _pickup, onPicked: (p) => setState(() { _pickup = p; _quote = null; })),
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
