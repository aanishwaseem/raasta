import 'dart:async';

import 'api_client.dart';
import 'device_location.dart';

/// Sends the driver's position to the API: from the OS location stream (keeps going in the background)
/// and from a timer fallback while the screen is open. Both paths share one throttle.
class LocationReporter {
  LocationReporter(this.api, this.location, {this.every = const Duration(seconds: 5), this.onFix});
  final ApiClient api;
  final DeviceLocation location;
  final Duration every;
  final void Function(Fix)? onFix;

  StreamSubscription<Fix>? _sub;
  Timer? _timer;
  DateTime _last = DateTime.fromMillisecondsSinceEpoch(0);

  void start() {
    stop();
    _sub = location.track().listen(_send, onError: (_) {});
    _timer = Timer.periodic(every, (_) async => _send(await location.current()));
  }

  /// Reads the position and sends it now, ignoring the throttle (e.g. just before "I've arrived").
  Future<void> sendNow() async => _send(await location.current(), force: true);

  Future<void> _send(Fix f, {bool force = false}) async {
    if (f.approximate) return;
    final now = DateTime.now();
    if (!force && now.difference(_last) < every - const Duration(milliseconds: 500)) return;
    _last = now;
    onFix?.call(f);
    try {
      await api.post('/driver/location', body: {
        'lat': f.lat,
        'lng': f.lng,
        if (f.heading != null) 'heading': f.heading,
        if (f.speed != null) 'speed': f.speed,
        if (f.accuracy != null) 'accuracy': f.accuracy,
      });
    } on ApiException {/* the next fix retries */}
  }

  void stop() {
    _sub?.cancel();
    _timer?.cancel();
    _sub = null;
    _timer = null;
  }
}
