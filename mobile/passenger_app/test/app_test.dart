import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:passenger_app/main.dart';
import 'package:raasta_core/raasta_core.dart';

class _FixedLocation extends DeviceLocation {
  @override
  Future<Fix> current() async => const Fix(31.5102, 74.3441);
}

http.Response j(Object b, [int s = 200]) => http.Response(jsonEncode(b), s, headers: {'content-type': 'application/json'});

/// The map keeps animating while tiles load, so settle with bounded pumps instead of pumpAndSettle.
Future<void> settle(WidgetTester t) async {
  for (var i = 0; i < 10; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  testWidgets('sign in, search a place, see fares', (tester) async {
    final api = ApiClient(
      baseUrl: 'http://x/api/v1',
      store: MemorySessionStore(),
      client: MockClient((req) async {
        final p = req.url.path;
        if (p.endsWith('/auth/login')) return j({'user': {'fullName': 'Bilal Ahmed', 'roles': ['PASSENGER']}, 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}});
        if (p.endsWith('/rides/active')) return j(<String, dynamic>{});
        if (p.endsWith('/places/reverse')) return j({'name': 'Liberty Market', 'address': 'Liberty Market, Lahore'});
        if (p.endsWith('/places/search')) return j([{'id': '1', 'name': 'Emporium Mall', 'address': 'Johar Town, Lahore', 'location': {'lat': 31.46, 'lng': 74.26}}]);
        if (p.endsWith('/rides/quotes')) {
          return j({'id': 'q1', 'distanceM': 12888, 'durationS': 1555, 'options': [{'productCode': 'ECONOMY', 'name': 'Economy', 'description': 'Everyday rides', 'availability': 'HIGH', 'pickupEtaS': 240, 'fare': {'recommended': 565, 'payable': 565}}]});
        }
        return j({'error': {'code': 'NOT_FOUND', 'message': 'x'}}, 404);
      }),
    );
    await tester.pumpWidget(PassengerApp(api: api, location: _FixedLocation()));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsWidgets);

    await tester.enterText(find.byType(TextField).at(0), 'bilal@raasta.test');
    await tester.enterText(find.byType(TextField).at(1), 'pw');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await settle(tester);
    expect(find.textContaining('Hi Bilal'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Where to?'), 'Emp');
    await settle(tester);
    await tester.tap(find.text('Emporium Mall'));
    await settle(tester);
    await tester.ensureVisible(find.text('See fares'));
    await tester.tap(find.text('See fares'));
    await settle(tester);
    await tester.scrollUntilVisible(find.text('Economy'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Economy'), findsOneWidget);
    expect(find.text('Rs 565'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Request ECONOMY'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Request ECONOMY'), findsOneWidget);
  });
}
