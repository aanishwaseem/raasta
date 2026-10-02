import 'json.dart';

class Place {
  const Place(this.name, this.address, this.lat, this.lng);
  final String name;
  final String address;
  final double lat;
  final double lng;

  /// Reads the API's place shape: {name, address, location: {lat, lng}}.
  factory Place.fromJson(Map<String, dynamic> j) {
    final loc = asJson(j['location']);
    final name = (j['name'] ?? j['address'] ?? 'Place').toString();
    return Place(name, (j['address'] ?? name).toString(), dbl(loc['lat']), dbl(loc['lng']));
  }

  /// Reads {lat, lng, address} (quotes, rides, suggestions).
  factory Place.fromPoint(Map<String, dynamic> j) {
    final a = (j['address'] ?? 'Selected place').toString();
    return Place(a.split(',').first.trim(), a, dbl(j['lat']), dbl(j['lng']));
  }

  Map<String, dynamic> toRequest() => {'lat': lat, 'lng': lng, 'address': address};
}
