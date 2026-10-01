import 'dart:async';

import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';


/// Step card for one trip: arrived -> PIN -> complete. Large controls, one primary action at a time.
class DriverTripScreen extends StatefulWidget {
  const DriverTripScreen({super.key, required this.api, required this.location, required this.rideId});
  final ApiClient api;
  final DeviceLocation location;
  final String rideId;

  @override
  State<DriverTripScreen> createState() => _DriverTripScreenState();
}

class _DriverTripScreenState extends State<DriverTripScreen> {
  Map<String, dynamic>? _ride;
  String? _error;
  bool _busy = false;
  Timer? _timer;
  Timer? _pingTimer;
  final _pin = TextEditingController();

  @override
  void initState() {
    super.initState();
    _poll();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _poll());
    _pingTimer = Timer.periodic(const Duration(seconds: 5), (_) => _ping().catchError((_) {}));
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pingTimer?.cancel();
    _pin.dispose();
    super.dispose();
  }

  ({double lat, double lng}) _pt(String key) {
    final p = _ride![key] as Map<String, dynamic>;
    return (lat: (p['lat'] as num).toDouble(), lng: (p['lng'] as num).toDouble());
  }

  Future<void> _poll() async {
    try {
      final r = await widget.api.get('/rides/${widget.rideId}') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() => _ride = r);
      final s = r['status'];
      if (s == 'COMPLETED' || s == 'CANCELLED') _timer?.cancel();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    }
  }

  Future<void> _act(Future<void> Function() fn) async {
    setState(() { _busy = true; _error = null; });
    try {
      await fn();
      await _poll();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.code == 'INVALID_PIN' ? 'That PIN is not right. Ask the rider to check it.' : e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _ping() async {
    final p = await widget.location.current();
    if (p.approximate) return;
    await widget.api.post('/driver/location', body: {'lat': p.lat, 'lng': p.lng, if (p.heading != null) 'heading': p.heading, if (p.speed != null) 'speed': p.speed});
  }

  @override
  Widget build(BuildContext context) {
    final r = _ride;
    if (r == null) return Scaffold(appBar: AppBar(title: const Text('Trip')), body: Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!)));
    final status = r['status'] as String;
    final base = '/driver/rides/${widget.rideId}';
    late final Widget action;
    String headline;
    switch (status) {
      case 'DRIVER_ASSIGNED':
      case 'DRIVER_ARRIVING':
        headline = 'Drive to pickup';
        action = FilledButton(onPressed: _busy ? null : () => _act(() async { await _ping(); await widget.api.post('$base/arrived'); }), child: const Text("I've arrived"));
      case 'DRIVER_ARRIVED':
        headline = 'Enter the rider\'s PIN';
        action = Column(children: [
          TextField(controller: _pin, onChanged: (_) => setState(() {}), keyboardType: TextInputType.number, maxLength: 4, textAlign: TextAlign.center, style: Theme.of(context).textTheme.displaySmall, decoration: const InputDecoration(counterText: '')),
          const SizedBox(height: 12),
          FilledButton(onPressed: _busy || _pin.text.length != 4 ? null : () => _act(() => widget.api.post('$base/start', body: {'pin': _pin.text})), child: const Text('Start trip')),
        ]);
      case 'IN_PROGRESS':
        headline = 'Trip in progress';
        final cash = r['paymentMethod'] == 'CASH';
        action = Column(children: [
          if (cash) Text('Collect ${money((r['fare'] as Map)['payable'])} cash', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          FilledButton(onPressed: _busy ? null : () => _act(() async { final f = await widget.location.current(); await widget.api.post('$base/complete', body: f.approximate ? {} : {'lat': f.lat, 'lng': f.lng}, idempotencyKey: 'complete-${widget.rideId}'); }), child: const Text('Complete trip')),
        ]);
      case 'COMPLETED':
        headline = 'Trip complete';
        action = FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Back to driving'));
      default:
        headline = prettyStatus(status);
        action = FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Back'));
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Trip')),
      bottomNavigationBar: SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: action)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(headline, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 12),
          if (r['passenger'] != null) Text('Rider: ${(r['passenger'] as Map)['firstName'] ?? ''}'),
          Text('Pickup: ${(r['pickup'] as Map)['address']}'),
          Text('Drop-off: ${(r['dropoff'] as Map)['address']}'),
          const SizedBox(height: 8),
          MapView(height: 180, pins: [MapPin(_pt('pickup').lat, _pt('pickup').lng, icon: Icons.trip_origin, label: 'Pickup'), MapPin(_pt('dropoff').lat, _pt('dropoff').lng, icon: Icons.flag, color: raastaAmber, label: 'Drop-off')], route: ((r['route'] as List?) ?? const []).map((e) => [(e[0] as num).toDouble(), (e[1] as num).toDouble()]).toList()),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        ],
      ),
    );
  }
}
