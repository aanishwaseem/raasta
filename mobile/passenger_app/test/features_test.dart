import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

Future<void> nav(WidgetTester t, String label) async {
  await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(label)));
  await settle(t, 600);
}

Future<void> tapText(WidgetTester t, Finder f, {int ms = 500}) async {
  await t.ensureVisible(f);
  await t.pump();
  await t.tap(f);
  await settle(t, ms);
}

void main() {
  testWidgets('assistant: a booking request needs an explicit confirmation before anything is booked', (tester) async {
    final server = await openApp(tester, {
      'POST /assistant/message': (_) => j({'reply': 'Economy from Liberty to Emporium for about Rs 565. Confirm?', 'intent': 'BOOK_RIDE', 'language': 'en', 'confidence': 0.9, 'missing': [], 'pendingAction': {'token': 'tok-aaaaaaaaaaaaaaaaaaaa', 'type': 'BOOK_RIDE', 'summary': 'Economy from Liberty to Emporium, about Rs 565, pay cash.', 'expiresInS': 600}}),
      'POST /assistant/confirm': (_) => j({'executed': 'BOOK_RIDE', 'ride': rideView('MATCHING')}),
      'GET /rides/:id': (_) => j(rideView('MATCHING')),
    });
    await tester.tap(find.byTooltip('Raasta Assistant'));
    await settle(tester);
    expect(find.text('Type or dictate'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Type or dictate'), 'Johar Town se Liberty jana hai');
    await tester.tap(find.byTooltip('Send'));
    await settle(tester);
    expect((server.bodies['POST /assistant/message'] as Map)['text'], 'Johar Town se Liberty jana hai');
    expect(find.text('Please confirm'), findsOneWidget);
    expect(find.textContaining('pay cash'), findsOneWidget);
    expect(server.called('POST /assistant/confirm'), isFalse);
    expect(server.called('POST /rides'), isFalse);

    await tester.tap(find.text('Confirm and book'));
    await settle(tester);
    expect((server.bodies['POST /assistant/confirm'] as Map)['token'], 'tok-aaaaaaaaaaaaaaaaaaaa');
    expect(find.text('Finding your driver'), findsWidgets);
  });

  testWidgets('voice mode parses speech, shows what was understood, and asks for missing details instead of booking', (tester) async {
    final server = await openApp(tester, {
      'POST /voice/parse': (_) => j({'language': 'ur', 'intent': 'BOOK_RIDE', 'confidence': 0.7, 'pickup': {'lat': 1.0, 'lng': 1.0, 'address': 'Johar Town, Lahore'}, 'dropoff': null, 'when': null, 'productCode': null, 'missing': ['dropoff'], 'confirmationText': 'Where would you like to go?', 'note': 'Nothing has been booked.'}),
    });
    await tester.tap(find.byTooltip('Book by voice'));
    await settle(tester);
    expect(find.textContaining('Voice mode'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Type or dictate'), 'Johar Town se jana hai');
    await tester.tap(find.byTooltip('Send'));
    await settle(tester);
    expect((server.bodies['POST /voice/parse'] as Map)['transcript'], 'Johar Town se jana hai');
    expect(find.text('Here is what I understood'), findsOneWidget);
    expect(find.text('Where would you like to go?'), findsOneWidget);
    expect(find.text('Please confirm'), findsNothing);
    expect(server.called('POST /assistant/confirm'), isFalse);
  });

  testWidgets('safety: add a trusted contact and see safety preferences and Ride PIN guidance', (tester) async {
    final server = await openApp(tester, {
      'POST /me/emergency-contacts': (_) => j({'id': 'c2', 'name': 'Omar', 'phone': '+923007654321'}),
      'PATCH /me/preferences': (_) => j({}),
    });
    await nav(tester, 'Safety');
    expect(find.text('Ayesha'), findsOneWidget);
    expect(find.textContaining('Call 15'), findsOneWidget);
    await tapText(tester, find.widgetWithText(TextButton, 'Add'));
    await tester.enterText(find.widgetWithText(TextField, 'Name'), 'Omar');
    await tester.enterText(find.widgetWithText(TextField, 'Phone (+92...)'), '+923007654321');
    await tapText(tester, find.text('Save contact'));
    final body = server.bodies['POST /me/emergency-contacts'] as Map;
    expect(body['name'], 'Omar');
    expect(body['phone'], '+923007654321');

    await tester.scrollUntilVisible(find.text('Route deviation alerts'), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Prefer a woman driver'));
    await settle(tester, 300);
    expect(((server.bodies['PATCH /me/preferences'] as Map)['safety'] as Map)['preferFemaleDriver'], true);
    await tester.scrollUntilVisible(find.text('How Ride PIN works'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('How Ride PIN works'), findsOneWidget);
  });

  testWidgets('wallet: top up sends an idempotency key and the chosen amount', (tester) async {
    final server = await openApp(tester, {
      'POST /wallet/topups': (_) => j({'paymentId': 'p', 'status': 'SUCCEEDED'}),
    });
    await nav(tester, 'Wallet');
    await tester.tap(find.widgetWithText(FilledButton, 'Top up'));
    await settle(tester, 600);
    expect(find.text('Top up wallet'), findsOneWidget);
    await tester.tap(find.text('Rs 2,000'));
    await tester.pump();
    await tester.tap(find.text('Add money'));
    await settle(tester);
    final body = server.bodies['POST /wallet/topups'] as Map;
    expect(body['amount'], 2000);
    expect(body['paymentMethodId'], 'm1');
    expect(server.headers['POST /wallet/topups']!['idempotency-key'], isNotEmpty);
  });

  testWidgets('activity: filter chips query the API; a ride opens with its receipt', (tester) async {
    final server = await openApp(tester, {
      'GET /rides': (_) => j({'items': [{'id': 'r9', 'status': 'COMPLETED', 'productCode': 'ECONOMY', 'pickupAddress': 'Gulberg III, Lahore', 'dropoffAddress': 'Emporium Mall, Johar Town', 'offeredFare': 565, 'finalFare': 560, 'requestedAt': '2026-09-30T10:00:00Z'}], 'total': 1, 'page': 1, 'pageSize': 20}),
      'GET /rides/:id': (_) => j(rideView('COMPLETED', extra: {'id': 'r9'})),
      'GET /rides/:id/receipt': (_) => j({'rideId': 'r9', 'paymentMethod': 'CASH', 'paymentStatus': 'PAID', 'pickupAddress': 'A', 'dropoffAddress': 'B', 'fare': {'agreed': 565, 'discount': 5, 'charged': 560, 'breakdown': {'base': 100, 'distance': 300, 'time': 100, 'bookingFee': 65}, 'explanation': ['Standard fare.']}, 'payments': []}),
    });
    await nav(tester, 'Activity');
    expect(find.text('Emporium Mall'), findsOneWidget);
    expect(find.text('Rs 560'), findsOneWidget);
    await tester.tap(find.widgetWithText(ChoiceChip, 'Completed'));
    await settle(tester, 500);
    expect(server.queries['GET /rides']!['status'], 'COMPLETED');
    await tester.tap(find.text('Emporium Mall'));
    await settle(tester, 800);
    await tapText(tester, find.text('View receipt'));
    expect(find.text('Total charged'), findsOneWidget);
    expect(find.text('Rs 560'), findsWidgets);
    expect(find.textContaining('Standard fare.'), findsOneWidget);
  });

  testWidgets('schedule a ride for later and list/cancel scheduled rides', (tester) async {
    final pending = <Map<String, dynamic>>[];
    final server = await openApp(tester, {
      'POST /rides/quotes': (_) => j(quote),
      'GET /scheduled-rides': (_) => j(pending),
      'POST /scheduled-rides': (_) {
        pending.add({'id': 's1', 'status': 'PENDING', 'pickup': {'lat': 1.0, 'lng': 1.0, 'address': 'Liberty Market, Lahore'}, 'dropoff': {'lat': 1.0, 'lng': 1.0, 'address': 'Emporium Mall, Johar Town'}, 'productCode': 'ECONOMY', 'paymentMethod': 'CASH', 'pickupAt': '2099-10-05T03:00:00Z', 'requiresConfirmation': false});
        return j({...pending.first, 'estimate': {'fare': 565}});
      },
      'DELETE /scheduled-rides/:id': (_) { pending.clear(); return j({'id': 's1', 'status': 'CANCELLED'}); },
    });
    await tester.tap(find.text('Schedule'));
    await settle(tester);
    expect(find.text('No upcoming rides'), findsOneWidget);
    await tester.tap(find.text('Schedule a ride'));
    await settle(tester);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Schedule ride')).onPressed, isNull);
    await tester.enterText(find.widgetWithText(TextField, 'Where to?'), 'Emp');
    await settle(tester);
    await tester.tap(find.text('Emporium Mall'));
    await settle(tester);
    expect(find.text('Economy'), findsOneWidget);
    await tapText(tester, find.widgetWithText(FilledButton, 'Schedule ride'), ms: 800);
    final body = server.bodies['POST /scheduled-rides'] as Map;
    expect(body['productCode'], 'ECONOMY');
    expect(body['paymentMethod'], 'CASH');
    expect(body.containsKey('pickupAt'), isTrue);
    expect(body.containsKey('targetArrivalAt'), isFalse);
    expect(find.textContaining('Emporium Mall'), findsWidgets);

    await tester.tap(find.text('Cancel'));
    await settle(tester, 300);
    await tester.tap(find.text('Cancel ride'));
    await settle(tester, 600);
    expect(server.called('DELETE /scheduled-rides/s1'), isTrue);
    expect(find.text('No upcoming rides'), findsOneWidget);
  });

  testWidgets('intercity: browse a route, book seats with an idempotency key', (tester) async {
    final server = await openApp(tester, {
      'GET /intercity/routes': (_) => j([{'id': 'rt1', 'origin': 'Lahore', 'destination': 'Islamabad', 'distanceKm': 380, 'typicalDurationMin': 270, 'suggestedSeatFare': 1800}]),
      'GET /intercity/trips': (_) => j([{'id': 't1', 'routeId': 'rt1', 'departureAt': '2099-10-05T03:00:00Z', 'pickupPoint': 'Thokar Niaz Baig', 'dropoffPoint': 'G-9 Islamabad', 'seatFare': 1800, 'luggagePolicy': 'ONE_BAG', 'status': 'OPEN', 'seatsLeft': 3, 'driverFirstName': 'Imran', 'make': 'Toyota', 'model': 'Corolla', 'color': 'White', 'ratingAvg': 4.8}]),
      'POST /intercity/trips/:id/book': (_) => j({'bookingId': 'b1', 'tripId': 't1', 'seats': 2, 'total': 3600, 'paymentMethod': 'CASH', 'paymentNote': 'Pay the driver in cash at pickup.'}),
      'GET /intercity/bookings': (_) => j([]),
    });
    await tester.tap(find.text('Intercity'));
    await settle(tester);
    await tester.tap(find.text('Lahore → Islamabad'));
    await settle(tester);
    expect(server.queries['GET /intercity/trips']!['routeId'], 'rt1');
    expect(find.textContaining('Thokar Niaz Baig'), findsOneWidget);
    await tapText(tester, find.widgetWithText(FilledButton, 'Book seats'), ms: 600);
    await tester.tap(find.byTooltip('Increase Seats'));
    await tester.pump();
    expect(find.text('Rs 3,600'), findsOneWidget);
    await tester.tap(find.text('Confirm booking'));
    await settle(tester);
    final body = server.bodies['POST /intercity/trips/t1/book'] as Map;
    expect(body['seats'], 2);
    expect(server.headers['POST /intercity/trips/t1/book']!['idempotency-key'], isNotEmpty);
    expect(find.text('My bookings'), findsOneWidget);
  });

  testWidgets('profile: edit name, deletion needs typing DELETE, sign out returns to sign in', (tester) async {
    final server = await openApp(tester, {'PATCH /me': (_) => j({})});
    await nav(tester, 'Profile');
    expect(find.text('Bilal Ahmed'), findsOneWidget);
    await tester.tap(find.byTooltip('Edit profile'));
    await settle(tester, 600);
    await tester.enterText(find.widgetWithText(TextField, 'Full name'), 'Bilal A. Khan');
    await tapText(tester, find.text('Save changes'));
    expect((server.bodies['PATCH /me'] as Map)['fullName'], 'Bilal A. Khan');

    await tester.scrollUntilVisible(find.text('Delete account'), 200, scrollable: find.byType(Scrollable).first);
    await tapText(tester, find.text('Delete account'));
    expect(find.text('Delete your account?'), findsOneWidget);
    TextButton del() => tester.widget<TextButton>(find.widgetWithText(TextButton, 'Delete account'));
    expect(del().onPressed, isNull);
    await tester.enterText(find.widgetWithText(TextField, 'Type DELETE to confirm'), 'DELETE');
    await tester.pump();
    expect(del().onPressed, isNotNull);
    await tester.tap(find.text('Keep my account'));
    await settle(tester, 300);

    await tester.tap(find.text('Sign out'));
    await settle(tester, 400);
    await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
    await settle(tester, 800);
    expect(find.text('Sign in'), findsWidgets);
  });

  testWidgets('privacy: personalization can be switched off and its data deleted', (tester) async {
    final server = await openApp(tester, {
      'GET /me/personalization': (_) => j({'personalizationEnabled': true, 'hasProfile': true, 'routines': [{'pickup': {'address': 'Gulberg III'}, 'dropoff': {'address': 'Emporium Mall'}, 'occurrences': 4, 'typicalMinutes': 495}], 'ridesConsidered': 9, 'explanation': 'Built only from your own completed rides.'}),
      'GET /me/consents': (_) => j([{'kind': 'LOCATION', 'granted': true}, {'kind': 'TERMS', 'granted': true}]),
      'PATCH /me/personalization': (_) => j({}),
      'DELETE /me/personalization': (_) => j({'deleted': true}),
    });
    await nav(tester, 'Profile');
    await tapText(tester, find.text('Privacy and personalization'), ms: 800);
    expect(find.textContaining('Built only from your own completed rides'), findsOneWidget);
    expect(find.textContaining('4 trips around 08:15'), findsOneWidget);
    await tester.tap(find.text('Smart suggestions'));
    await settle(tester, 500);
    expect((server.bodies['PATCH /me/personalization'] as Map)['enabled'], false);
    await tapText(tester, find.text('Delete learned data'));
    await tester.tap(find.widgetWithText(TextButton, 'Delete'));
    await settle(tester, 500);
    expect(server.called('DELETE /me/personalization'), isTrue);
  });

  testWidgets('saved places: add a place and support ticket flow work', (tester) async {
    final server = await openApp(tester, {
      'POST /me/places': (_) => j({}),
      'GET /support/tickets': (_) => j({'items': [], 'total': 0}),
      'POST /support/tickets': (_) => j({'id': 't1'}),
    });
    await nav(tester, 'Profile');
    await tapText(tester, find.text('Saved places'), ms: 800);
    expect(find.text('Gulberg III, Lahore'), findsOneWidget);
    await tester.tap(find.text('Add place'));
    await settle(tester, 600);
    await tester.enterText(find.widgetWithText(TextField, 'Search for the place'), 'Emp');
    await settle(tester);
    await tester.tap(find.text('Emporium Mall'));
    await settle(tester, 300);
    await tapText(tester, find.text('Save place'));
    final body = server.bodies['POST /me/places'] as Map;
    expect(body['label'], 'FAVORITE');
    expect(body['lat'], 31.46);
    await tester.pageBack();
    await settle(tester, 500);
    await tapText(tester, find.text('Help and support'), ms: 800);
    expect(find.text('No tickets'), findsOneWidget);
    await tester.tap(find.text('New ticket'));
    await settle(tester, 600);
    await tester.enterText(find.widgetWithText(TextField, 'Subject'), 'Charged twice');
    await tester.enterText(find.widgetWithText(TextField, 'What happened?'), 'I was charged twice for my ride');
    await tapText(tester, find.text('Send'));
    final t = server.bodies['POST /support/tickets'] as Map;
    expect(t['subject'], 'Charged twice');
    expect(t['category'], 'OTHER');
  });
}
