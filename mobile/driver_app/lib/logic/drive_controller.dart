import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

/// State of the Drive tab: online/offline, location reporting, incoming offers (realtime push with
/// polling as the safety net) and the copilot summary. The screen only renders this.
class DriveController extends ChangeNotifier {
  DriveController(this.api, this.location);
  final ApiClient api;
  final DeviceLocation location;

  bool online = false;
  bool busy = false;
  bool responding = false;
  bool networkDown = false;
  String? error;
  String? gpsProblem;
  String? notice;
  Fix? pos;
  Map<String, dynamic>? offer;
  Map<String, dynamic> copilot = {};
  void Function(String rideId)? onTrip;

  Timer? _timer;
  LocationReporter? _reporter;
  RealtimeClient? _rt;
  StreamSubscription<String>? _sub;
  bool _disposed = false;

  Map<String, dynamic> get today => asMap(copilot['today']);
  List<Map<String, dynamic>> get recommendations => asList(copilot['recommendations']);

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  Future<void> init() async {
    await refreshLocation();
    await Future.wait([_resume(), loadCopilot()]);
    // the app may have been restarted while still online on the server
    if (copilot['online'] == true && !online) {
      online = true;
      _startOnline();
      _changed();
    }
  }

  Future<void> refreshLocation() async {
    final p = await location.current();
    gpsProblem = p.approximate ? (location.lastProblem ?? 'Your location is unavailable.') : null;
    pos = p;
    _changed();
  }

  Future<void> _resume() async {
    try {
      final r = await api.get('/driver/rides/active');
      final ride = r is List ? (r.isEmpty ? null : r.first) : r;
      if (ride is Map && ride['id'] != null) onTrip?.call(ride['id'] as String);
    } on ApiException {/* nothing to resume */}
  }

  Future<void> loadCopilot() async {
    try {
      copilot = asMap(await api.get('/driver/copilot'));
      networkDown = false;
    } on ApiException catch (e) {
      if (isNetworkError(e)) networkDown = true;
    }
    _changed();
  }

  Future<void> toggle() async {
    if (busy) return;
    busy = true;
    error = null;
    _changed();
    try {
      if (online) {
        await api.post('/driver/offline');
        _stopOnline();
        online = false;
        offer = null;
      } else {
        final p = await location.current();
        pos = p;
        if (p.approximate) {
          gpsProblem = location.lastProblem ?? 'Your location is unavailable.';
          error = 'Turn on location to go online.';
          return;
        }
        gpsProblem = null;
        await api.post('/driver/online', body: {'lat': p.lat, 'lng': p.lng});
        online = true;
        networkDown = false;
        _startOnline();
        unawaited(loadCopilot());
      }
    } on ApiException catch (e) {
      error = e.friendly;
      if (isNetworkError(e)) networkDown = true;
    } finally {
      busy = false;
      _changed();
    }
  }

  void _startOnline() {
    _rt = api.realtime();
    // 'ride.offer' pushes make offers instant; polling stays as the fallback
    _sub = _rt?.events.listen((e) {
      if (e == 'ride.offer' || e == 'ride.offer_expired' || e == 'ride.cancelled') pollOffer();
    });
    _timer = Timer.periodic(Duration(seconds: _rt == null ? 3 : 10), (_) => pollOffer());
    _reporter = LocationReporter(api, location, onFix: (f) {
      pos = f;
      gpsProblem = null;
      _changed();
    })..start();
    unawaited(pollOffer());
  }

  void _stopOnline() {
    _timer?.cancel();
    _reporter?.stop();
    _sub?.cancel();
    _rt?.dispose();
    _timer = _reporter = _sub = _rt = null;
  }

  Future<void> pollOffer() async {
    if (!online) return;
    try {
      final o = await api.get('/driver/offers/current');
      networkDown = false;
      final next = o is Map ? Map<String, dynamic>.from(o) : null;
      if (offer != null && next == null && !responding) notice = 'That request is no longer available.';
      if (next?['offerId'] != offer?['offerId'] || next == null) offer = next;
    } on ApiException catch (e) {
      if (isNetworkError(e)) networkDown = true;
    }
    _changed();
  }

  void expireOffer() {
    if (offer == null) return;
    offer = null;
    notice = 'The ride request timed out.';
    _changed();
  }

  Future<void> respond(bool accept) async {
    final o = offer;
    if (o == null || responding) return;
    responding = true;
    _changed();
    try {
      await api.post('/driver/offers/${o['offerId']}/${accept ? 'accept' : 'decline'}');
      offer = null;
      if (accept) onTrip?.call(o['rideId'] as String);
    } on ApiException catch (e) {
      notice = e.friendly;
      if (!isNetworkError(e)) offer = null;
    } finally {
      responding = false;
      _changed();
    }
  }

  void clearNotice() => notice = null;

  @override
  void dispose() {
    _disposed = true;
    _stopOnline();
    super.dispose();
  }
}
