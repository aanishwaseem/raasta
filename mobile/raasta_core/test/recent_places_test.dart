import 'package:flutter_test/flutter_test.dart';
import 'package:raasta_core/raasta_core.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('keeps the newest places first, de-duplicates and caps the list', () async {
    final s = RecentPlacesStore(max: 3);
    for (var i = 0; i < 5; i++) {
      await s.add({'name': 'Place $i', 'address': 'Street $i', 'lat': 31.5 + i / 100, 'lng': 74.3});
    }
    await s.add({'name': 'Place 4 again', 'address': 'Street 4', 'lat': 31.54, 'lng': 74.3});
    final l = await s.load();
    expect(l.map((p) => p['name']), ['Place 4 again', 'Place 3', 'Place 2']);
  });

  test('offline search filters the cache by name or address, ignoring case', () async {
    final s = RecentPlacesStore();
    await s.add({'name': 'Liberty Market', 'address': 'Gulberg III, Lahore', 'lat': 31.51, 'lng': 74.34});
    await s.add({'name': 'Emporium Mall', 'address': 'Johar Town, Lahore', 'lat': 31.46, 'lng': 74.26});
    expect((await s.search('gulberg')).single['name'], 'Liberty Market');
    expect(await s.search('karachi'), isEmpty);
  });

  test('corrupt storage yields an empty list instead of an exception', () async {
    SharedPreferences.setMockInitialValues({'raasta.recent_places': 'not json'});
    expect(await RecentPlacesStore().load(), isEmpty);
  });
}
