import 'dart:async';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import '../widgets/banners.dart';
import '../widgets/cancel_sheet.dart';
import '../widgets/complete_panel.dart';
import '../widgets/driver_map.dart';
import '../widgets/sos_button.dart';
import '../widgets/trip_panels.dart';

/// One trip, one primary action at a time: pickup > arrived > PIN > start > complete > rate.
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
  String? _error; // fatal: ride could not be loaded
  String? _actionError; // inline: last action failed
  bool _busy = false;
  bool _networkDown = false;
  String? _gpsProblem;
  Fix? _pos;
  Timer? _timer;
  RealtimeClient? _rt;
  StreamSubscription<String>? _rtSub;
  LocationReporter? _reporter;

  @override
  void initState() {
    super.initState();
    _poll();
    _locate();
    _rt = widget.api.realtime(rideId: widget.rideId);
    _rtSub = _rt?.events.listen((_) => _poll());
    // pushes make updates instant; polling stays as the fallback
    _timer = Timer.periodic(Duration(seconds: _rt == null ? 3 : 10), (_) => _poll());
    _reporter = LocationReporter(widget.api, widget.location, onFix: (f) { if (mounted) setState(() { _pos = f; _gpsProblem = null; }); })..start();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _rtSub?.cancel();
    _rt?.dispose();
    _reporter?.stop();
    super.dispose();
  }

  Future<void> _locate() async {
    final f = await widget.location.current();
    if (mounted) setState(() { _pos = f; _gpsProblem = f.approximate ? (widget.location.lastProblem ?? 'Your location is unavailable.') : null; });
  }

  Future<void> _poll() async {
    try {
      final r = asMap(await widget.api.get('/rides/${widget.rideId}'));
      if (!mounted) return;
      setState(() { _ride = r; _networkDown = false; _error = null; });
      if (r['status'] == 'COMPLETED' || r['status'] == 'CANCELLED') _timer?.cancel();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { if (isNetworkError(e)) _networkDown = true; if (_ride == null) _error = e.friendly; });
    }
  }

  Future<void> _act(Future<void> Function() fn) async {
    setState(() { _busy = true; _actionError = null; });
    try {
      await fn();
      await _poll();
    } on ApiException catch (e) {
      if (mounted) setState(() => _actionError = e.code == 'INVALID_PIN' ? 'That PIN is not right. Ask the rider to check it.' : e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final reason = await pickCancelReason(context);
    if (reason == null || !mounted) return;
    setState(() { _busy = true; _actionError = null; });
    try {
      await widget.api.post('/driver/rides/${widget.rideId}/cancel', body: {'reason': reason});
      if (mounted) Navigator.pop(context, 'cancelled');
    } on ApiException catch (e) {
      if (mounted) setState(() { _actionError = e.friendly; _busy = false; });
    }
  }

  LatLng _latLng(Map<String, dynamic> p) => LatLng(dbl(p['lat']), dbl(p['lng']));

  @override
  Widget build(BuildContext context) {
    final r = _ride;
    if (r == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Trip')),
        body: _error == null ? const Padding(padding: EdgeInsets.all(16), child: SkeletonList(count: 3, height: 110)) : ErrorState(message: _error!, onRetry: _poll),
      );
    }
    final status = r['status'] as String;
    if (status == 'COMPLETED') return Scaffold(appBar: AppBar(title: const Text('Trip summary'), automaticallyImplyLeading: false), body: SafeArea(child: CompletePanel(api: widget.api, ride: r, onDone: () => Navigator.pop(context))));
    if (const ['CANCELLED', 'NO_DRIVERS', 'EXPIRED'].contains(status)) return Scaffold(appBar: AppBar(title: const Text('Trip')), body: SafeArea(child: EndedPanel(ride: r, onDone: () => Navigator.pop(context))));

    final pickup = _latLng(asMap(r['pickup']));
    final drop = _latLng(asMap(r['dropoff']));
    final inTrip = status == 'IN_PROGRESS';
    final pos = _pos;
    final center = pos == null || pos.approximate ? (inTrip ? drop : pickup) : LatLng(pos.lat, pos.lng);
    final target = inTrip ? drop : pickup;
    final remaining = pos == null || pos.approximate ? null : distanceM(pos.lat, pos.lng, target.latitude, target.longitude);
    final route = [for (final p in (r['route'] as List? ?? const [])) if (p is List && p.length >= 2) LatLng(dbl(p[0]), dbl(p[1]))];
    final Widget panel;
    switch (status) {
      case 'DRIVER_ARRIVED':
        panel = PinPanel(ride: r, busy: _busy, error: _actionError, onCancel: _cancel, onStart: (pin) => _act(() async { await widget.api.post('/driver/rides/${widget.rideId}/start', body: {'pin': pin}); }));
      case 'IN_PROGRESS':
        panel = ProgressPanel(ride: r, remainingM: remaining, busy: _busy, onComplete: () => _act(() async {
              final f = await widget.location.current();
              await widget.api.post('/driver/rides/${widget.rideId}/complete', body: f.approximate ? {} : {'lat': f.lat, 'lng': f.lng}, idempotencyKey: 'complete-${widget.rideId}');
            }));
      default:
        panel = PickupPanel(ride: r, distanceM: remaining, busy: _busy, onCancel: _cancel, onArrived: () => _act(() async { await _reporter?.sendNow(); await widget.api.post('/driver/rides/${widget.rideId}/arrived'); }));
    }
    final h = MediaQuery.sizeOf(context).height;
    return Scaffold(
      body: Stack(children: [
        Positioned.fill(child: DriverMap(attribution: false, center: center, fitKey: status, route: route, pins: [MapPin(pickup.latitude, pickup.longitude, icon: Icons.trip_origin, color: goGreen, label: 'Pickup'), MapPin(drop.latitude, drop.longitude, icon: Icons.location_on, color: raastaAmber, label: 'Drop-off')])),
        Positioned(
          top: 0, left: 0, right: 0,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Column(children: [
                  _StepCard(status: status),
                  if (_networkDown) Padding(padding: const EdgeInsets.only(top: 8), child: NetworkBanner(onRetry: _poll)),
                  if (_gpsProblem != null) Padding(padding: const EdgeInsets.only(top: 8), child: GpsBanner(problem: _gpsProblem!, onRetry: _locate)),
                ])),
                const SizedBox(width: 12),
                SosButton(api: widget.api, location: widget.location, rideId: widget.rideId, position: pos),
              ]),
            ),
          ),
        ),
        Positioned(
          left: 0, right: 0, bottom: 0,
          child: MapSheet(child: ConstrainedBox(constraints: BoxConstraints(maxHeight: h * 0.72), child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (_actionError != null && status != 'DRIVER_ARRIVED') Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_actionError!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontWeight: FontWeight.w700))),
            panel,
          ])))),
        ),
      ]),
    );
  }
}

class _StepCard extends StatelessWidget {
  const _StepCard({required this.status});
  final String status;
  @override
  Widget build(BuildContext context) {
    final (title, sub) = switch (status) {
      'DRIVER_ARRIVED' => ('At pickup', 'Enter the rider\'s PIN to start'),
      'IN_PROGRESS' => ('Trip in progress', 'Drive safely'),
      _ => ('Drive to pickup', 'Follow the route on the map'),
    };
    final t = Theme.of(context);
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 60),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(color: t.colorScheme.surface.withValues(alpha: 0.95), borderRadius: BorderRadius.circular(18), border: Border.all(color: t.colorScheme.primary.withValues(alpha: 0.6))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: t.textTheme.titleMedium), Text(sub, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant))]),
    );
  }
}
