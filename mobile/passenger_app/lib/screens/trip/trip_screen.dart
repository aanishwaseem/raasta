import 'dart:async';

import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';
// ignore: implementation_imports
import 'package:raasta_core/src/passenger_safety_alerts.dart';

import '../../util/json.dart';
import '../../widgets/banner.dart';
import '../../widgets/full_bleed_map.dart';
import '../../widgets/share_ride_sheet.dart';
import '../../widgets/sos.dart';
import '../activity/receipt_screen.dart';
import 'cancel_sheet.dart';
import 'rating_screen.dart';
import 'safety_prompt.dart';
import 'trip_panels.dart';

const _active = {'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'};

/// Follows one ride: realtime pushes make updates instant, polling is the safety net.
/// [alerts] lets tests inject safety prompts; in the app they come from the realtime socket.
class TripScreen extends StatefulWidget {
  const TripScreen({super.key, required this.api, required this.rideId, this.location, this.alerts});
  final ApiClient api;
  final String rideId;
  final DeviceLocation? location;
  final Stream<Map<String, dynamic>>? alerts;

  @override
  State<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends State<TripScreen> {
  Json? _ride;
  String? _error;
  bool _busy = false;
  bool _promptOpen = false;
  bool _askedRating = false;
  Timer? _timer;
  RealtimeClient? _rt;
  SafetyAlertFeed? _feed;
  StreamSubscription<String>? _rtSub;
  StreamSubscription<Map<String, dynamic>>? _alertSub;
  String? _retryKey;

  @override
  void initState() {
    super.initState();
    _poll();
    _rt = widget.api.realtime(rideId: widget.rideId);
    _rtSub = _rt?.events.listen((_) => _poll());
    _feed = widget.alerts == null ? SafetyAlertFeed.connect(widget.api) : null;
    _alertSub = (widget.alerts ?? _feed?.alerts)?.listen(_onAlert);
    _timer = Timer.periodic(Duration(seconds: _rt == null ? 3 : 10), (_) => _poll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _rtSub?.cancel();
    _alertSub?.cancel();
    _rt?.dispose();
    _feed?.dispose();
    super.dispose();
  }

  Future<void> _poll() async {
    try {
      final r = asJson(await widget.api.get('/rides/${widget.rideId}'));
      if (!mounted) return;
      final before = _ride?['status'];
      setState(() { _ride = r; _error = null; });
      if (!_active.contains(r['status'])) _timer?.cancel();
      if (before != null && before != 'COMPLETED' && r['status'] == 'COMPLETED' && r['myRating'] == null && !_askedRating) {
        _askedRating = true;
        WidgetsBinding.instance.addPostFrameCallback((_) => mounted ? _rate() : null);
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = isOffline(e) ? 'You appear to be offline. Trying to reconnect…' : e.friendly);
    }
  }

  Future<void> _onAlert(Json alert) async {
    if (_promptOpen || !mounted || (alert['rideId'] != null && alert['rideId'] != widget.rideId)) return;
    _promptOpen = true;
    await showSafetyPrompt(context, widget.api, alert, location: widget.location);
    _promptOpen = false;
  }

  Future<void> _cancel() async {
    final reason = await askCancelReason(context, driverAssigned: _ride?['driver'] != null);
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = asJson(await widget.api.post('/rides/${widget.rideId}/cancel', body: {'reason': reason}));
      final fee = dbl(r['cancellationFee']);
      if (mounted && fee > 0) toast(context, 'Ride cancelled. A cancellation fee of Rs ${fee.round()} applies.');
      await _poll();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _retry({bool raise = false}) async {
    setState(() => _busy = true);
    _retryKey ??= ApiClient.newIdempotencyKey();
    try {
      final offered = dbl(asJson(_ride?['fare'])['offered']).round();
      final r = asJson(await widget.api.post('/rides/${widget.rideId}/retry', idempotencyKey: _retryKey, body: raise ? {'offeredFare': offered + 50} : {}));
      _retryKey = null;
      if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, rideId: r['id'] as String, location: widget.location)));
    } on ApiException catch (e) {
      if (mounted) { toast(context, e.friendly); if (e.status < 500) _retryKey = null; }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _payCash() async {
    try {
      await widget.api.post('/rides/${widget.rideId}/pay-cash', body: {});
      await _poll();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  Future<void> _rate() async {
    final done = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => RatingScreen(api: widget.api, rideId: widget.rideId, driver: _ride?['driver'] is Map ? asJson(_ride!['driver']) : null)));
    if (done == true) _poll();
  }

  @override
  Widget build(BuildContext context) {
    final r = _ride;
    final size = MediaQuery.of(context).size;
    final actions = TripActions(
      onShare: () => showShareRideSheet(context, widget.api, widget.rideId),
      onSos: () => confirmAndSendSos(context, widget.api, widget.rideId, location: widget.location),
      onCancel: _cancel,
      onRate: _rate,
      onReceipt: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ReceiptScreen(api: widget.api, rideId: widget.rideId))),
      onRetry: _retry,
      onClose: () => Navigator.of(context).popUntil((r) => r.isFirst),
      onPayCash: _payCash,
    );
    return Scaffold(
      body: Stack(fit: StackFit.expand, children: [
        if (r != null) Positioned(left: 0, right: 0, top: 0, bottom: size.height * (r['driver'] != null ? 0.52 : 0.40), child: _map(r, size)),
        Positioned(top: 0, left: 0, child: SafeArea(child: Padding(padding: const EdgeInsets.all(8), child: IconButton.filledTonal(tooltip: 'Back', onPressed: () => Navigator.pop(context), icon: const Icon(Icons.arrow_back))))),
        if (r == null)
          Center(child: _error == null ? const CircularProgressIndicator() : ErrorState(message: _error!, onRetry: _poll))
        else
          Positioned(
            left: 0, right: 0, bottom: 0,
            child: MapSheet(
              child: Material(type: MaterialType.transparency, child: SizedBox(width: double.infinity, child: ConstrainedBox(
                constraints: BoxConstraints(maxHeight: size.height * 0.66),
                child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  if (_error != null) InlineBanner(_error!),
                  TripPanel(ride: r, actions: actions, busy: _busy),
                ])),
              ))),
            ),
          ),
      ]),
    );
  }

  Widget _map(Json r, Size size) {
    final p = asJson(r['pickup']), d = asJson(r['dropoff']);
    final loc = r['driver'] is Map ? asJson(asJson(r['driver'])['location']) : <String, dynamic>{};
    return FullBleedMap(
      pins: [
        MapPin(dbl(p['lat']), dbl(p['lng']), icon: Icons.trip_origin, label: 'Pickup'),
        MapPin(dbl(d['lat']), dbl(d['lng']), icon: Icons.flag, color: raastaAmber, label: 'Drop-off'),
        if (loc['lat'] != null) MapPin(dbl(loc['lat']), dbl(loc['lng']), icon: Icons.directions_car, color: Colors.black87, label: 'Driver'),
      ],
      route: [for (final e in (r['route'] as List? ?? const [])) [dbl((e as List)[0]), dbl(e[1])]],
    );
  }
}
