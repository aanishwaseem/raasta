import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:passenger_app/main.dart';
import 'package:raasta_core/raasta_core.dart';

http.Response j(Object b, [int s = 200]) => http.Response(jsonEncode(b), s, headers: {'content-type': 'application/json'});

void main() {
  testWidgets('sign in, search a place, see fares', (tester) async {
    final api = ApiClient(
      baseUrl: 'http://x/api/v1',
      store: MemorySessionStore(),
      client: MockClient((req) async {
        final p = req.url.path;
        if (p.endsWith('/auth/login')) return j({'user': {'fullName': 'Bilal Ahmed', 'roles': ['PASSENGER']}, 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}});
        if (p.endsWith('/rides/active')) return j(<String, dynamic>{});
        if (p.endsWith('/places/search')) return j([{'id': '1', 'name': 'Emporium Mall', 'address': 'Johar Town, Lahore', 'location': {'lat': 31.46, 'lng': 74.26}}]);
        if (p.endsWith('/rides/quotes')) {
          return j({'id': 'q1', 'distanceM': 12888, 'durationS': 1555, 'options': [{'productCode': 'ECONOMY', 'name': 'Economy', 'description': 'Everyday rides', 'availability': 'HIGH', 'pickupEtaS': 240, 'fare': {'recommended': 565, 'payable': 565}}]});
        }
        return j({'error': {'code': 'NOT_FOUND', 'message': 'x'}}, 404);
      }),
    );
    await tester.pumpWidget(PassengerApp(api: api));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);

    await tester.enterText(find.byType(TextField).at(0), 'bilal@raasta.test');
    await tester.enterText(find.byType(TextField).at(1), 'pw');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Hi Bilal'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Where to?'), 'Emp');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Emporium Mall'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('See fares'));
    await tester.pumpAndSettle();
    expect(find.text('Economy'), findsOneWidget);
    expect(find.text('Rs 565'), findsOneWidget);
    expect(find.text('Request ECONOMY'), findsOneWidget);
  });
}
