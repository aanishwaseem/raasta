import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:driver_app/main.dart';
import 'package:raasta_core/raasta_core.dart';

http.Response j(Object b, [int s = 200]) => http.Response(jsonEncode(b), s, headers: {'content-type': 'application/json'});

class _FixedLocation extends DeviceLocation {
  @override
  Future<Fix> current() async => const Fix(31.5105, 74.3432);
}

/// The map keeps animating while tiles load, so settle with bounded pumps instead of pumpAndSettle.
Future<void> settle(WidgetTester t, {int ms = 1000}) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> signIn(WidgetTester tester) async {
  await tester.enterText(find.byType(TextField).at(0), 'driver@raasta.test');
  await tester.enterText(find.byType(TextField).at(1), 'pw');
  await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
  await settle(tester);
}

ApiClient apiWith(Map<String, dynamic> me, {List<String> roles = const ['DRIVER'], bool offers = false}) {
  return ApiClient(
    baseUrl: 'http://x/api/v1',
    store: MemorySessionStore(),
    client: MockClient((req) async {
      final p = req.url.path;
      if (p.endsWith('/auth/login')) return j({'user': {'fullName': 'Usman Tariq', 'roles': roles}, 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}});
      if (p.endsWith('/driver/me')) return j(me);
      if (p.endsWith('/driver/rides/active')) return j([]);
      if (p.endsWith('/driver/online')) return j({'status': 'IDLE'});
      if (p.endsWith('/driver/offline')) return j({'online': false});
      if (p.endsWith('/driver/location')) return j({'ok': true});
      if (p.endsWith('/driver/offers/current')) {
        return offers
            ? j({'offerId': 'o1', 'rideId': 'r1', 'fare': 565, 'pickupDistanceM': 800, 'tripDistanceM': 12888, 'paymentMethod': 'CASH', 'pickupAddress': 'Liberty Market', 'dropoffAddress': 'Emporium Mall', 'pickup': {'lat': 31.51, 'lng': 74.34}})
            : http.Response('null', 200, headers: {'content-type': 'application/json'});
      }
      return j({'error': {'code': 'NOT_FOUND', 'message': 'x'}}, 404);
    }),
  );
}

void main() {
  testWidgets('a passenger account is rejected by the driver app', (tester) async {
    await tester.pumpWidget(DriverApp(api: apiWith({}, roles: ['PASSENGER']), location: _FixedLocation()));
    await settle(tester);
    await signIn(tester);
    expect(find.textContaining('not registered as a driver'), findsOneWidget);
  });

  testWidgets('an approved driver goes online and sees an offer', (tester) async {
    await tester.pumpWidget(DriverApp(api: apiWith({'status': 'APPROVED', 'canGoOnline': true}, offers: true), location: _FixedLocation()));
    await settle(tester);
    await signIn(tester);
    expect(find.text('You are offline'), findsOneWidget);

    await tester.tap(find.text('Go online'));
    await settle(tester, ms: 4500);
    expect(find.text('You are online'), findsOneWidget);
    expect(find.text('Rs 565'), findsOneWidget);
    expect(find.text('Accept'), findsOneWidget);

    await tester.tap(find.text('Go offline'));
    await settle(tester);
    expect(find.text('You are offline'), findsOneWidget);
  });

  testWidgets('submit is enabled once everything is done or waiting for review', (tester) async {
    final me = {
      'status': 'ONBOARDING',
      'canGoOnline': false,
      'checklist': [
        {'key': 'IDENTITY', 'label': 'Identity (CNIC & licence)', 'status': 'DONE'},
        {'key': 'CNIC_FRONT', 'label': 'CNIC (front)', 'status': 'PENDING'},
        {'key': 'VEHICLE', 'label': 'Vehicle details', 'status': 'PENDING'},
        {'key': 'REVIEW', 'label': 'Review by Raasta team', 'status': 'MISSING'},
        {'key': 'TRAINING', 'label': 'Safety & code of conduct', 'status': 'MISSING'},
      ],
    };
    await tester.pumpWidget(DriverApp(api: apiWith(me), location: _FixedLocation()));
    await settle(tester);
    await signIn(tester);
    final submit = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit for review'));
    expect(submit.onPressed, isNotNull);
  });

  testWidgets('a new driver sees the onboarding checklist and cannot submit yet', (tester) async {
    final me = {
      'status': 'ONBOARDING',
      'canGoOnline': false,
      'checklist': [
        {'key': 'IDENTITY', 'label': 'Identity (CNIC & licence)', 'status': 'MISSING'},
        {'key': 'CNIC_FRONT', 'label': 'CNIC (front)', 'status': 'MISSING'},
        {'key': 'VEHICLE', 'label': 'Vehicle details', 'status': 'MISSING'},
        {'key': 'REVIEW', 'label': 'Review by Raasta team', 'status': 'MISSING'},
        {'key': 'TRAINING', 'label': 'Safety & code of conduct', 'status': 'MISSING'},
      ],
    };
    await tester.pumpWidget(DriverApp(api: apiWith(me), location: _FixedLocation()));
    await settle(tester);
    await signIn(tester);
    expect(find.text('Become a driver'), findsOneWidget);
    expect(find.text('Identity (CNIC & licence)'), findsOneWidget);
    expect(find.text('Safety & code of conduct'), findsNothing);
    final submit = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit for review'));
    expect(submit.onPressed, isNull);
  });
}
