import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:passenger_app/util/place.dart';
import 'package:passenger_app/widgets/place_field.dart';
import 'package:raasta_core/raasta_core.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'helpers.dart';

Future<ApiClient> api(FakeServer s) async {
  final store = MemorySessionStore();
  await store.write(const Session(accessToken: 'a', refreshToken: 'r', name: 'B', roles: ['PASSENGER']));
  return ApiClient(baseUrl: 'http://x/api/v1', store: store, client: s.client);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('a chosen place is remembered and offered again when the search request fails (offline)', (tester) async {
    var online = true;
    final server = FakeServer({
      'GET /places/search': (_) => online ? j([{'id': '1', 'name': 'Emporium Mall', 'address': 'Johar Town, Lahore', 'location': {'lat': 31.46, 'lng': 74.26}}]) : err(503, 'UNAVAILABLE', 'down'),
    });
    final picked = <Place>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PlaceField(api: await api(server), label: 'Where to?', icon: Icons.search, onPicked: picked.add))));

    await tester.enterText(find.byType(TextField), 'empo');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    await tester.tap(find.text('Emporium Mall'));
    await tester.pump();
    expect(picked.single.name, 'Emporium Mall');
    expect((await RecentPlacesStore().load()).single['name'], 'Emporium Mall');

    online = false;
    await tester.enterText(find.byType(TextField), 'emporium');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    await tester.pump();
    expect(find.text('You are offline. Showing places you used before.'), findsOneWidget);
    expect(find.text('Emporium Mall'), findsWidgets);
  });
}
