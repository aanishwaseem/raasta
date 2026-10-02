import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:passenger_app/main.dart';
import 'package:raasta_core/raasta_core.dart';

import 'helpers.dart';

void main() {
  testWidgets('sign in lands on the map home with greeting and Where to?', (tester) async {
    phone(tester);
    final server = FakeServer({
      'POST /auth/login': (_) => j({'user': {'fullName': 'Bilal Ahmed', 'roles': ['PASSENGER']}, 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}}),
    });
    final api = ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore(), client: server.client);
    await tester.pumpWidget(PassengerApp(api: api, location: FixedLocation()));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsWidgets);

    await tester.enterText(find.byType(TextField).at(0), 'bilal@raasta.test');
    await tester.enterText(find.byType(TextField).at(1), 'pw');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await settle(tester);
    expect(find.textContaining('Hi Bilal'), findsOneWidget);
    expect(find.text('Where to?'), findsOneWidget);
    expect(find.byTooltip('Book by voice'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets('bottom tabs open Activity, Wallet, Safety and Profile and keep working', (tester) async {
    await openApp(tester);
    for (final (label, title) in [('Activity', 'No rides yet'), ('Wallet', 'Raasta wallet'), ('Safety', 'Trusted contacts'), ('Profile', 'Saved places')]) {
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(label)));
      await settle(tester, 600);
      expect(find.text(title), findsWidgets, reason: label);
    }
    // Wallet shows the balance and a real transaction.
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Wallet')));
    await settle(tester, 300);
    expect(find.text('Rs 1,500'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Wallet top-up Rs 2000'), 300, scrollable: find.byType(Scrollable).hitTestable().first);
    expect(find.text('Wallet top-up Rs 2000'), findsOneWidget);
  });

  testWidgets('home shows saved Home chip, a usual-trip suggestion with its reason, and never books by itself', (tester) async {
    final server = await openApp(tester, {
      'GET /me/suggestions': (_) => j([
            {'routineId': 'rt1', 'title': 'Your usual trip to Emporium Mall?', 'pickup': {'lat': 31.51, 'lng': 74.34, 'address': 'Gulberg III, Lahore'}, 'dropoff': {'lat': 31.46, 'lng': 74.26, 'address': 'Emporium Mall, Johar Town'}, 'productCode': 'ECONOMY', 'suggestedPickupAt': '2026-10-01T03:00:00Z', 'typicalFare': 560, 'confidence': 0.8, 'reason': 'You took this trip 4 times around 08:15 on weekdays.'},
          ]),
      'GET /scheduled-rides': (_) => j([
            {'id': 's1', 'status': 'PENDING', 'pickup': {'lat': 1.0, 'lng': 1.0, 'address': 'Home, Lahore'}, 'dropoff': {'lat': 1.0, 'lng': 1.0, 'address': 'Airport, Lahore'}, 'productCode': 'ECONOMY', 'paymentMethod': 'CASH', 'pickupAt': '2099-10-05T03:00:00Z', 'requiresConfirmation': false},
          ]),
      'POST /rides/quotes': (_) => j(quote),
    });
    expect(find.text('Home'), findsWidgets);
    final sheet = find.descendant(of: find.byType(DraggableScrollableSheet), matching: find.byType(Scrollable)).first;
    await tester.scrollUntilVisible(find.text('Your usual trips'), 150, scrollable: sheet);
    expect(find.textContaining('You took this trip 4 times'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Upcoming rides'), 150, scrollable: sheet);
    expect(find.text('Upcoming rides'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Book this trip'), -150, scrollable: sheet);
    expect(server.called('POST /rides'), isFalse);

    await tester.tap(find.text('Book this trip'));
    await settle(tester);
    // Booking opens pre-filled with fares, but still nothing is requested until the rider taps Request.
    expect(find.text('Economy'), findsWidgets);
    expect(find.textContaining('Request Economy'), findsOneWidget);
    expect(server.called('POST /rides'), isFalse);
  });

  testWidgets('home recovers from being offline with a retry banner', (tester) async {
    var down = true;
    await openApp(tester, {
      for (final p in ['GET /me', 'GET /me/places', 'GET /rides', 'GET /me/suggestions', 'GET /scheduled-rides']) p: (r) => down ? err(0, 'NETWORK', 'x') : j(p == 'GET /me' ? {'fullName': 'Bilal Ahmed'} : (p == 'GET /rides' ? {'items': []} : [])),
    });
    // Status 0 responses are not network failures for the client; they still surface as a friendly banner (>=3 failures).
    expect(find.textContaining('could not be loaded'), findsOneWidget);
    down = false;
    await tester.tap(find.text('Retry'));
    await settle(tester);
    expect(find.textContaining('could not be loaded'), findsNothing);
  });
}
