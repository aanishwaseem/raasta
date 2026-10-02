import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Small on-device list of places the person actually chose, newest first.
/// It is what makes place search usable on a weak connection: suggestions are filtered from here when the network fails.
class RecentPlacesStore {
  RecentPlacesStore({this.max = 8, this.key = 'raasta.recent_places'});
  final int max;
  final String key;

  Future<List<Map<String, dynamic>>> load() async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(key);
      if (raw == null) return [];
      return (jsonDecode(raw) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } on Object {
      return []; // corrupt or unavailable storage must never break booking
    }
  }

  /// Adds [place] ({name, address, lat, lng}) to the front, de-duplicating by rounded coordinates.
  Future<void> add(Map<String, dynamic> place) async {
    String id(Map<String, dynamic> p) => '${(p['lat'] as num).toStringAsFixed(4)},${(p['lng'] as num).toStringAsFixed(4)}';
    final list = await load()
      ..removeWhere((p) => id(p) == id(place))
      ..insert(0, place);
    try {
      await (await SharedPreferences.getInstance()).setString(key, jsonEncode(list.take(max).toList()));
    } on Object {/* best effort */}
  }

  /// Case-insensitive match on name or address; used as the offline fallback for search.
  Future<List<Map<String, dynamic>>> search(String q) async {
    final needle = q.trim().toLowerCase();
    return (await load()).where((p) => '${p['name']} ${p['address']}'.toLowerCase().contains(needle)).toList();
  }

  Future<void> clear() async => (await SharedPreferences.getInstance()).remove(key);
}
