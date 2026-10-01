import 'dart:async';

import 'package:geolocator/geolocator.dart';

class Fix {
  const Fix(this.lat, this.lng, {this.heading, this.speed, this.accuracy, this.approximate = false});
  final double lat;
  final double lng;
  final double? heading;
  final double? speed;
  final double? accuracy;

  /// True when this is the city-centre fallback rather than a real device fix.
  final bool approximate;
}

/// Where the device is. Falls back to a city centre (flagged `approximate`) when permission is denied or location is off,
/// so screens always have something to show and can tell the person why.
class DeviceLocation {
  DeviceLocation({this.fallbackLat = 31.5204, this.fallbackLng = 74.3587});
  final double fallbackLat;
  final double fallbackLng;
  String? lastProblem;

  Future<bool> _ensure() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      lastProblem = 'Location is turned off on this device.';
      return false;
    }
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) {
      lastProblem = 'Location permission is needed to find rides near you.';
      return false;
    }
    lastProblem = null;
    return true;
  }

  Fix _fallback() => Fix(fallbackLat, fallbackLng, approximate: true);

  Fix _from(Position p) => Fix(p.latitude, p.longitude,
      heading: p.heading.isFinite && p.heading >= 0 ? p.heading : null,
      speed: p.speed.isFinite && p.speed >= 0 ? p.speed : null,
      accuracy: p.accuracy.isFinite ? p.accuracy : null);

  Future<Fix> current() async {
    try {
      if (!await _ensure()) return _fallback();
      return _from(await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 10))));
    } catch (_) {
      lastProblem ??= 'Could not read your location.';
      return _fallback();
    }
  }

  /// Continuous fixes (every ~10 m). Emits nothing when permission is missing.
  Stream<Fix> stream() async* {
    try {
      if (!await _ensure()) return;
      yield* Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 10)).map(_from);
    } catch (_) {
      lastProblem ??= 'Location updates stopped.';
    }
  }
}
