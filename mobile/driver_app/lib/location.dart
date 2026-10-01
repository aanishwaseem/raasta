/// Source of the driver's position. The API needs pings to detect arrival (300 m geofence) and to trace the trip.
abstract class LocationSource {
  /// Current position, optionally moving toward [target] (used only by the simulator).
  Future<({double lat, double lng})> current({({double lat, double lng})? target});
}

/// Development stand-in: starts in Lahore and steps toward the target each call.
/// Replace with a geolocator-backed implementation before real-world use (see mobile/README.md).
class SimulatedLocation implements LocationSource {
  SimulatedLocation({double lat = 31.5105, double lng = 74.3432}) : _lat = lat, _lng = lng; // ignore: prefer_initializing_formals
  double _lat;
  double _lng;

  @override
  Future<({double lat, double lng})> current({({double lat, double lng})? target}) async {
    if (target != null) {
      _lat += (target.lat - _lat) * 0.5;
      _lng += (target.lng - _lng) * 0.5;
    }
    return (lat: _lat, lng: _lng);
  }

  void jumpTo(double lat, double lng) { _lat = lat; _lng = lng; }
}
