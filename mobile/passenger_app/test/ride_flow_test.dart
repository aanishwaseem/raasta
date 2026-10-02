import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:passenger_app/screens/trip/trip_screen.dart';
import 'package:raasta_core/raasta_core.dart';

import 'helpers.dart';

Future<ApiClient> _api(FakeServer s) async {
  final store = MemorySessionStore();
  await store.write(const Session(accessToken: 'a', refreshToken: 'r', name: 'Bilal', roles: ['PASSENGER']));
  final api = ApiClient(baseUrl: 'http://x/api/v1', store: store, client: s.client);
  await api.restore();
  return api;
}

Future<void> _openTrip(WidgetTester tester, FakeServer s, {Stream<Map<String, dynamic>>? alerts}) async {
  phone(tester);
  final api = await _api(s);
  await tester.pumpWidget(MaterialApp(theme: raastaTheme(), home: TripScreen(api: api, rideId: 'r1', location: FixedLocation(), alerts: alerts)));
  await settle(tester, 500);
}

Future<void> _tap(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f);
  await settle(tester, 500);
}

void main() {
  testWidgets('book: search, compare AI-tagged fares, request with an idempotency key, then see driver, plate and PIN', (tester) async {
    var status = 'MATCHING';
    var created = false;
    final server = await openApp(tester, {
      'POST /rides/quotes': (_) => j(quote),
      'POST /rides': (_) { created = true; return j(rideView('MATCHING')); },
      'GET /rides/active': (_) => created ? j(rideView(status)) : j(<String, dynamic>{}),
      'GET /rides/:id': (_) => j(rideView(status, pin: status == 'DRIVER_ASSIGNED' ? '4821' : null)),
    });
    await tester.tap(find.text('Where to?'));
    await settle(tester);
    await tester.enterText(find.widgetWithText(TextField, 'Where to?'), 'Emp');
    await settle(tester);
    await tester.tap(find.text('Emporium Mall'));
    await settle(tester);

    expect(server.bodies['POST /rides/quotes'], isA<Map>());
    expect(find.text('Economy'), findsOneWidget);
    expect(find.text('Bike'), findsOneWidget);
    expect(find.text('Cheapest'), findsOneWidget);
    expect(find.text('Fastest'), findsOneWidget);
    expect(find.text('Rs 565'), findsWidgets);
    expect(find.textContaining('High demand near Johar Town'), findsOneWidget);
    await _tap(tester, find.textContaining('Why Rs 565'));
    expect(find.textContaining('Standard fare: enough drivers'), findsWidgets);

    await _tap(tester, find.textContaining('Request Economy'));
    final body = server.bodies['POST /rides'] as Map;
    expect(body['quoteId'], 'q1');
    expect(body['productCode'], 'ECONOMY');
    expect(body['paymentMethod'], 'CASH');
    expect(server.headers['POST /rides']!['idempotency-key'], isNotEmpty);
    expect(find.text('Finding your driver'), findsWidgets);
    // Home reloads when Booking is replaced by the trip; it must not stack a second trip screen on top.
    expect(find.byType(TripScreen), findsOneWidget);

    status = 'DRIVER_ASSIGNED';
    await settle(tester, 3500);
    expect(find.text('Driver on the way'), findsOneWidget);
    expect(find.text('Usman'), findsOneWidget);
    expect(find.text('LEA-1234'), findsOneWidget);
    expect(find.text('4 8 2 1'), findsOneWidget);
    expect(find.text('Share ride'), findsOneWidget);
    expect(find.text('SOS'), findsOneWidget);
  });

  testWidgets('cancel asks for a reason and sends it', (tester) async {
    var status = 'DRIVER_ASSIGNED';
    final server = FakeServer({
      'GET /rides/:id': (_) => j(rideView(status, pin: '1234')),
      'POST /rides/:id/cancel': (_) { status = 'CANCELLED'; return j({'ride': rideView('CANCELLED'), 'cancellationFee': 0}); },
    });
    await _openTrip(tester, server);
    await _tap(tester, find.widgetWithText(TextButton, 'Cancel ride'));
    expect(find.text('Cancel this ride?'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Cancel ride'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Cancel ride')).onPressed, isNull, reason: 'a reason is required');
    await tester.tap(find.text('Driver is too far'));
    await tester.pump();
    await _tap(tester, find.widgetWithText(FilledButton, 'Cancel ride'));
    expect((server.bodies['POST /rides/r1/cancel'] as Map)['reason'], 'DRIVER_TOO_FAR');
    await settle(tester, 3500);
    expect(find.text('Ride cancelled'), findsWidgets);
  });

  testWidgets('no drivers offers a retry that requests again with an idempotency key', (tester) async {
    final server = FakeServer({
      'GET /rides/r1': (_) => j(rideView('NO_DRIVERS')),
      'GET /rides/r2': (_) => j({...rideView('MATCHING'), 'id': 'r2'}),
      'POST /rides/:id/retry': (_) => j({...rideView('MATCHING'), 'id': 'r2'}),
    });
    await _openTrip(tester, server);
    expect(find.text('No drivers available'), findsWidgets);
    expect(find.textContaining('Retry with Rs 615'), findsOneWidget);
    await _tap(tester, find.text('Try again'));
    expect(server.called('POST /rides/r1/retry'), isTrue);
    expect(server.headers['POST /rides/r1/retry']!['idempotency-key'], isNotEmpty);
    expect(find.text('Finding your driver'), findsWidgets);
    expect(server.called('GET /rides/r2'), isTrue);
  });

  testWidgets('route deviation shows the safety prompt and each button does something', (tester) async {
    final alerts = StreamController<Map<String, dynamic>>.broadcast();
    addTearDown(alerts.close);
    final server = FakeServer({
      'GET /rides/:id': (_) => j(rideView('IN_PROGRESS')),
      'POST /safety/events/:id/respond': (r) => j({'eventId': 'e1', 'status': 'CONFIRMED_SAFE', 'driverPhone': '+923009998877'}),
    });
    await _openTrip(tester, server, alerts: alerts.stream);
    alerts.add({'eventId': 'e1', 'rideId': 'r1', 'type': 'ROUTE_DEVIATION', 'severity': 'MEDIUM', 'message': 'Your ride appears to have deviated from the expected route.', 'detail': 'About 450 m away from the planned route.'});
    await settle(tester, 500);
    expect(find.text('Are you safe?'), findsOneWidget);
    expect(find.textContaining('deviated from the expected route'), findsOneWidget);
    for (final b in ["I'm safe", 'Contact driver', 'Share ride', 'SOS']) {
      expect(find.text(b), findsWidgets, reason: b);
    }
    await tester.tap(find.text('Contact driver'));
    await settle(tester, 300);
    expect((server.bodies['POST /safety/events/e1/respond'] as Map)['response'], 'CONTACT_DRIVER');
    expect(find.textContaining('+923009998877'), findsOneWidget);
    await tester.tap(find.text("I'm safe"));
    await settle(tester, 500);
    expect((server.bodies['POST /safety/events/e1/respond'] as Map)['response'], 'SAFE');
    expect(find.text('Are you safe?'), findsNothing);
  });

  testWidgets('trip ended away from the destination only offers actions that still work (no share or contact driver)', (tester) async {
    final alerts = StreamController<Map<String, dynamic>>.broadcast();
    addTearDown(alerts.close);
    final server = FakeServer({'GET /rides/:id': (_) => j(rideView('COMPLETED'))});
    await _openTrip(tester, server, alerts: alerts.stream);
    alerts.add({
      'eventId': 'e2', 'rideId': 'r1', 'type': 'END_FAR_FROM_DESTINATION', 'severity': 'LOW', 'message': 'Your trip ended away from the destination you set.',
      'actions': [{'code': 'SAFE', 'label': "I'm Safe"}, {'code': 'SOS', 'label': 'SOS'}],
    });
    await settle(tester, 500);
    expect(find.text('Are you safe?'), findsOneWidget);
    expect(find.text("I'm safe"), findsOneWidget);
    expect(find.text('SOS'), findsWidgets);
    expect(find.text('Share ride'), findsNothing);
    expect(find.text('Contact driver'), findsNothing);
  });

  testWidgets('completed trip: receipt summary, then rating with stars, tags and comment', (tester) async {
    final server = FakeServer({
      'GET /rides/r1': (_) => j(rideView('COMPLETED')),
      'POST /rides/:id/rating': (_) => j({'rideId': 'r1', 'stars': 4, 'tags': ['POLITE'], 'role': 'PASSENGER'}),
    });
    await _openTrip(tester, server);
    expect(find.text('Trip complete'), findsOneWidget);
    expect(find.textContaining('Pay your driver Rs 565 in cash'), findsOneWidget);
    expect(find.text('Receipt'), findsOneWidget);
    await _tap(tester, find.text('Rate your driver'));
    expect(find.text('How was your ride?'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit rating')).onPressed, isNull);
    await tester.tap(find.byIcon(Icons.star_outline_rounded).at(3));
    await tester.pump();
    await tester.tap(find.text('Polite'));
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextField, 'Comment (optional)'), 'Smooth ride');
    await _tap(tester, find.text('Submit rating'));
    final body = server.bodies['POST /rides/r1/rating'] as Map;
    expect(body['stars'], 4);
    expect(body['tags'], ['POLITE']);
    expect(body['comment'], 'Smooth ride');
  });
}
