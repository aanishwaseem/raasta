import 'dart:convert';

import 'package:driver_app/location.dart';
import 'package:driver_app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:raasta_core/raasta_core.dart';

http.Response j(Object b, [int s = 200]) => http.Response(jsonEncode(b), s, headers: {'content-type': 'application/json'});

void main() {
  testWidgets('rejects a passenger account, then driver goes online and sees an offer', (tester) async {
    var role = 'PASSENGER';
    var offerShown = false;
    final api = ApiClient(
      baseUrl: 'http://x/api/v1',
      store: MemorySessionStore(),
      client: MockClient((req) async {
        final p = req.url.path;
        if (p.endsWith('/auth/login')) return j({'user': {'fullName': 'Usman Tariq', 'roles': [role]}, 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}});
        if (p.endsWith('/driver/rides/active')) return j([]);
        if (p.endsWith('/driver/online')) return j({'status': 'IDLE'});
        if (p.endsWith('/driver/offline')) return j({'online': false});
        if (p.endsWith('/driver/location')) return j({'ok': true});
        if (p.endsWith('/driver/offers/current')) {
          offerShown = true;
          return j({'offerId': 'o1', 'rideId': 'r1', 'fare': 565, 'pickupDistanceM': 800, 'tripDistanceM': 12888, 'paymentMethod': 'CASH', 'pickupAddress': 'Liberty Market', 'dropoffAddress': 'Emporium Mall'});
        }
        return j({'error': {'code': 'NOT_FOUND', 'message': 'x'}}, 404);
      }),
    );
    await tester.pumpWidget(DriverApp(api: api, location: SimulatedLocation()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), 'bilal@raasta.test');
    await tester.enterText(find.byType(TextField).at(1), 'pw');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.textContaining('not registered as a driver'), findsOneWidget);

    role = 'DRIVER';
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('You are offline'), findsOneWidget);

    await tester.tap(find.text('Go online'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 4));
    expect(find.text('You are online'), findsOneWidget);
    expect(offerShown, isTrue);
    expect(find.text('Rs 565'), findsOneWidget);
    expect(find.text('Accept'), findsOneWidget);

    await tester.tap(find.text('Go offline'));
    await tester.pumpAndSettle();
    expect(find.text('You are offline'), findsOneWidget);
  });
}
