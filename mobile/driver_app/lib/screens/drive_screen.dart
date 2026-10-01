import 'dart:async';

import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import 'earnings_screen.dart';
import 'trip_screen.dart';

/// Offline / online home. While online it pings location every 5s and polls for the current offer every 3s.
class DriveScreen extends StatefulWidget {
  const DriveScreen({super.key, required this.api, required this.location, required this.onSignOut});
  final ApiClient api;
  final DeviceLocation location;
  final VoidCallback onSignOut;

  @override
  State<DriveScreen> createState() => _DriveScreenState();
}

class _DriveScreenState extends State<DriveScreen> {
  bool _online = false;
  bool _busy = false;
  String? _error;
  Map<String, dynamic>? _offer;
  Fix? _pos;
  Timer? _offerTimer;
  LocationReporter? _reporter;
  RealtimeClient? _rt;
  StreamSubscription<String>? _rtSub;

  @override
  void initState() {
    super.initState();
    _resume();
  }

  @override
  void dispose() {
    _offerTimer?.cancel();
    _reporter?.stop();
    _rtSub?.cancel();
    _rt?.dispose();
    super.dispose();
  }

  Future<void> _resume() async {
    try {
      final r = await widget.api.get('/driver/rides/active');
      final ride = r is List ? (r.isEmpty ? null : r.first) : r;
      if (ride is Map && ride['id'] != null && mounted) _openTrip(ride['id'] as String);
    } on ApiException {/* ignore */}
  }

  void _openTrip(String id) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => DriverTripScreen(api: widget.api, location: widget.location, rideId: id))).then((_) {
      if (mounted) setState(() => _offer = null);
    });
  }

  Future<void> _toggle() async {
    setState(() { _busy = true; _error = null; });
    try {
      if (_online) {
        await widget.api.post('/driver/offline');
        _offerTimer?.cancel();
        _reporter?.stop();
        _rtSub?.cancel();
        _rt?.dispose();
        _rt = null;
        setState(() { _online = false; _offer = null; });
      } else {
        final p = await widget.location.current();
        if (p.approximate) {
          setState(() => _error = '${widget.location.lastProblem ?? 'Your location is unavailable.'} Turn on location to go online.');
          return;
        }
        await widget.api.post('/driver/online', body: {'lat': p.lat, 'lng': p.lng});
        _pos = p;
        setState(() => _online = true);
        _rt = widget.api.realtime();
        _rtSub = _rt?.events.listen((_) => _pollOffer());
        // pushes deliver offers instantly; polling is the fallback
        _offerTimer = Timer.periodic(Duration(seconds: _rt == null ? 3 : 10), (_) => _pollOffer());
        _reporter = LocationReporter(widget.api, widget.location, onFix: (f) { if (mounted) setState(() => _pos = f); })..start();
      }
    } on ApiException catch (e) {
      setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pollOffer() async {
    try {
      final o = await widget.api.get('/driver/offers/current');
      if (mounted) setState(() => _offer = o is Map<String, dynamic> ? o : null);
    } on ApiException {/* keep last state */}
  }

  Future<void> _respond(bool accept) async {
    final id = _offer!['offerId'] as String;
    final rideId = _offer!['rideId'] as String;
    try {
      await widget.api.post('/driver/offers/$id/${accept ? 'accept' : 'decline'}');
      setState(() => _offer = null);
      if (accept && mounted) _openTrip(rideId);
    } on ApiException catch (e) {
      setState(() { _error = e.friendly; _offer = null; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = _offer;
    return Scaffold(
      appBar: AppBar(title: const Text('Drive'), actions: [
        IconButton(tooltip: 'Earnings', icon: const Icon(Icons.payments_outlined), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => EarningsScreen(api: widget.api)))),
        IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: _online ? null : widget.onSignOut),
      ]),
      bottomNavigationBar: SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: FilledButton(onPressed: _busy ? null : _toggle, child: Text(_online ? 'Go offline' : 'Go online')))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(_online ? 'You are online' : 'You are offline', style: Theme.of(context).textTheme.headlineMedium),
          Text(_online ? 'Waiting for ride requests…' : 'Go online to receive ride requests.'),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
          const SizedBox(height: 12),
          if (_pos != null) MapView(height: 180, pins: [MapPin(_pos!.lat, _pos!.lng, icon: Icons.directions_car, color: Colors.black87, label: 'You'), if (o != null) MapPin((o['pickup']['lat'] as num).toDouble(), (o['pickup']['lng'] as num).toDouble(), icon: Icons.trip_origin, label: 'Pickup')]),
          const SizedBox(height: 12),
          if (o != null) _OfferCard(offer: o, onAccept: () => _respond(true), onDecline: () => _respond(false)),
        ],
      ),
    );
  }
}

class _OfferCard extends StatelessWidget {
  const _OfferCard({required this.offer, required this.onAccept, required this.onDecline});
  final Map<String, dynamic> offer;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(money(offer['fare']), style: Theme.of(context).textTheme.displaySmall),
          Text('${km(offer['pickupDistanceM'])} to pickup · ${km(offer['tripDistanceM'])} trip · ${offer['paymentMethod']}'),
          const SizedBox(height: 8),
          Text('From: ${offer['pickupAddress']}'),
          Text('To: ${offer['dropoffAddress']}'),
          const SizedBox(height: 12),
          FilledButton(onPressed: onAccept, child: const Text('Accept')),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: onDecline, child: const Text('Decline')),
        ]),
      ),
    );
  }
}
