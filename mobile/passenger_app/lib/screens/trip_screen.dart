import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:raasta_core/raasta_core.dart';

const _active = {'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'};
const _cancellable = {'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'};

/// Follows one ride by polling the role-aware ride snapshot every 3s (the API also offers a realtime socket).
class TripScreen extends StatefulWidget {
  const TripScreen({super.key, required this.api, required this.rideId});
  final ApiClient api;
  final String rideId;

  @override
  State<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends State<TripScreen> {
  Map<String, dynamic>? _ride;
  String? _error;
  Timer? _timer;
  RealtimeClient? _rt;
  StreamSubscription<String>? _rtSub;
  int _stars = 0;
  bool _rated = false;

  @override
  void initState() {
    super.initState();
    _poll();
    _rt = widget.api.realtime(rideId: widget.rideId);
    _rtSub = _rt?.events.listen((_) => _poll());
    // pushes make updates instant; polling stays as the fallback
    _timer = Timer.periodic(Duration(seconds: _rt == null ? 3 : 10), (_) => _poll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _rtSub?.cancel();
    _rt?.dispose();
    super.dispose();
  }

  Future<void> _poll() async {
    try {
      final r = await widget.api.get('/rides/${widget.rideId}') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() { _ride = r; _error = null; _rated = r['myRating'] != null; });
      if (!_active.contains(r['status'])) _timer?.cancel();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    }
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(title: const Text('Cancel this ride?'), actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep ride')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Cancel ride'))]),
    );
    if (ok != true) return;
    try {
      await widget.api.post('/rides/${widget.rideId}/cancel', body: {'reason': 'CHANGED_MIND'});
      await _poll();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.friendly)));
    }
  }

  Future<void> _sos() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Send an SOS alert?'),
        content: const Text('Raasta safety staff and your trusted contacts will be alerted with your live location.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Not now')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Send SOS'))],
      ),
    );
    if (ok != true) return;
    final f = await DeviceLocation().current();
    try {
      await widget.api.post('/rides/${widget.rideId}/sos', body: f.approximate ? {} : {'location': {'lat': f.lat, 'lng': f.lng}});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('SOS sent. Help is being alerted.')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('SOS could not be sent: ${e.friendly}')));
    }
  }

  Future<void> _share() async {
    try {
      final r = await widget.api.post('/rides/${widget.rideId}/share', body: {}) as Map<String, dynamic>;
      await Clipboard.setData(ClipboardData(text: r['url'] as String));
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Trip link copied${(r['recipients'] ?? 0) > 0 ? ' and sent to ${r['recipients']} contact(s)' : ''}.')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.friendly)));
    }
  }

  Future<void> _rate(int stars) async {
    setState(() => _stars = stars);
    try {
      await widget.api.post('/rides/${widget.rideId}/rating', body: {'stars': stars});
      if (mounted) setState(() => _rated = true);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.friendly)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _ride;
    return Scaffold(
      appBar: AppBar(title: const Text('Your ride')),
      body: r == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : ListView(padding: const EdgeInsets.all(16), children: [
              _StatusBanner(status: r['status'] as String),
              const SizedBox(height: 12),
              Text('${r['pickup']['address']} to ${r['dropoff']['address']}'),
              const SizedBox(height: 12),
              MapView(
                height: 200,
                pins: [
                  MapPin((r['pickup']['lat'] as num).toDouble(), (r['pickup']['lng'] as num).toDouble(), icon: Icons.trip_origin, label: 'Pickup'),
                  MapPin((r['dropoff']['lat'] as num).toDouble(), (r['dropoff']['lng'] as num).toDouble(), icon: Icons.flag, color: raastaAmber, label: 'Drop-off'),
                  if (r['driver']?['location'] != null) MapPin((r['driver']['location']['lat'] as num).toDouble(), (r['driver']['location']['lng'] as num).toDouble(), icon: Icons.directions_car, color: Colors.black87, label: 'Driver'),
                ],
                route: ((r['route'] as List?) ?? const []).map((e) => [(e[0] as num).toDouble(), (e[1] as num).toDouble()]).toList(),
              ),
              const SizedBox(height: 12),
              if (r['driver'] != null) _DriverCard(driver: r['driver'] as Map<String, dynamic>),
              if (r['pin'] != null && _cancellable.contains(r['status']))
                Card(child: ListTile(title: const Text('Share this PIN with your driver'), trailing: Text('${r['pin']}', style: Theme.of(context).textTheme.headlineMedium))),
              Card(child: ListTile(title: const Text('Fare'), trailing: Text(money(r['fare']['final'] ?? r['fare']['payable'])))),
              if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              const SizedBox(height: 12),
              if (r['status'] == 'IN_PROGRESS' || r['status'] == 'DRIVER_ARRIVED' || r['status'] == 'DRIVER_ARRIVING' || r['status'] == 'DRIVER_ASSIGNED')
                Row(children: [
                  Expanded(child: OutlinedButton.icon(onPressed: _share, icon: const Icon(Icons.share_outlined), label: const Text('Share trip'))),
                  const SizedBox(width: 12),
                  Expanded(child: OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: raastaDanger), onPressed: _sos, icon: const Icon(Icons.sos), label: const Text('SOS'))),
                ]),
              const SizedBox(height: 8),
              if (_cancellable.contains(r['status'])) OutlinedButton(onPressed: _cancel, child: const Text('Cancel ride')),
              if (r['status'] == 'NO_DRIVERS') FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Back to fares')),
              if (r['status'] == 'COMPLETED')
                _rated
                    ? const Center(child: Text('Thanks for rating your trip.'))
                    : Column(children: [
                        const Text('How was your trip?'),
                        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                          for (var i = 1; i <= 5; i++) IconButton(iconSize: 36, icon: Icon(i <= _stars ? Icons.star : Icons.star_border, color: Colors.amber), onPressed: () => _rate(i)),
                        ]),
                      ]),
            ]),
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.status});
  final String status;

  static const _copy = {
    'MATCHING': 'Finding you a driver…',
    'DRIVER_ASSIGNED': 'Driver on the way',
    'DRIVER_ARRIVING': 'Driver is almost there',
    'DRIVER_ARRIVED': 'Your driver has arrived',
    'IN_PROGRESS': 'On your way',
    'COMPLETED': 'Trip complete',
    'CANCELLED': 'Ride cancelled',
    'NO_DRIVERS': 'No drivers available right now',
  };

  @override
  Widget build(BuildContext context) => Text(_copy[status] ?? prettyStatus(status), style: Theme.of(context).textTheme.headlineSmall);
}

class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.driver});
  final Map<String, dynamic> driver;

  @override
  Widget build(BuildContext context) {
    final v = driver['vehicle'] as Map<String, dynamic>?;
    return Card(
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.person)),
        title: Text('${driver['firstName'] ?? 'Your driver'}'),
        subtitle: Text(v == null ? '' : '${v['color'] ?? ''} ${v['make'] ?? ''} ${v['model'] ?? ''} · ${v['plateNumber'] ?? ''}'.trim()),
      ),
    );
  }
}
