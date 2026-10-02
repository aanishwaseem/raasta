import 'package:driver_app/main.dart';
import 'package:driver_app/widgets/complete_panel.dart';
import 'package:driver_app/widgets/pin_pad.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:raasta_core/raasta_core.dart';

import 'helpers.dart';

Future<FakeApi> boot(WidgetTester tester, FakeApi api, {DeviceLocationFactory? location}) async {
  phone(tester);
  await tester.pumpWidget(DriverApp(api: api.client(), location: location?.call() ?? FixedLocation()));
  await settle(tester);
  await signIn(tester);
  return api;
}

typedef DeviceLocationFactory = DeviceLocation Function();

void main() {
  testWidgets('a passenger account is rejected by the driver app', (tester) async {
    await boot(tester, FakeApi(roles: ['PASSENGER']));
    expect(find.textContaining('not registered as a driver'), findsOneWidget);
  });

  testWidgets('the app uses the dark driver theme', (tester) async {
    await boot(tester, FakeApi());
    expect(Theme.of(tester.element(find.byType(NavigationBar))).brightness, Brightness.dark);
  });

  testWidgets('an approved driver gets five tabs and an offline drive screen with today stats and a prediction', (tester) async {
    await boot(tester, FakeApi());
    for (final l in ['Drive', 'Earnings', 'Demand', 'Wallet', 'Profile']) {
      expect(find.descendant(of: find.byType(NavigationBar), matching: find.text(l)), findsOneWidget);
    }
    expect(find.text('You are offline'), findsOneWidget);
    expect(find.text('Go online'), findsOneWidget);
    expect(find.text('Trips'), findsOneWidget);
    expect(find.text('Rs 2,400'), findsOneWidget);
    expect(find.text('Copilot prediction'), findsOneWidget);
    await tester.tap(find.text('Copilot prediction'));
    await settle(tester, ms: 500);
    expect(find.textContaining('not a guarantee'), findsWidgets);
  });

  testWidgets('going online shows an offer; decline returns to waiting; offline works', (tester) async {
    final api = await boot(tester, FakeApi(offerOpen: true));
    await tester.tap(find.text('Go online'));
    await settle(tester, ms: 1500);
    expect(find.text('You are online'), findsOneWidget);
    expect(find.text('Rs 565'), findsOneWidget);
    expect(find.text('Liberty Market'), findsOneWidget);
    expect(find.text('Emporium Mall'), findsOneWidget);
    expect(find.textContaining('0.8 km'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsWidgets); // countdown ring

    await tester.tap(find.text('Decline'));
    await settle(tester, ms: 500);
    expect(api.calls, contains('POST /driver/offers/o1/decline'));
    expect(find.text('Accept'), findsNothing);

    await tester.tap(find.text('Go offline'));
    await settle(tester);
    expect(find.text('You are offline'), findsOneWidget);
    expect(api.calls, contains('POST /driver/offline'));
  });

  testWidgets('GPS off blocks going online with a clear message', (tester) async {
    final api = await boot(tester, FakeApi(), location: NoGps.new);
    expect(find.textContaining('Location is turned off'), findsWidgets);
    await tester.tap(find.text('Go online'));
    await settle(tester);
    expect(find.text('You are offline'), findsOneWidget);
    expect(api.calls, isNot(contains('POST /driver/online')));
  });

  testWidgets('accepting walks the whole trip: arrived, PIN, start, complete, rate', (tester) async {
    final api = await boot(tester, FakeApi(offerOpen: true));
    await tester.tap(find.text('Go online'));
    await settle(tester, ms: 1500);
    await tester.tap(find.text('Accept'));
    await settle(tester, ms: 1000);

    expect(find.text('Drive to pickup'), findsOneWidget);
    expect(find.text('SOS'), findsOneWidget);
    expect(find.text('Liberty Market'), findsOneWidget);
    await tester.tap(find.text("I've arrived"));
    await settle(tester, ms: 600);

    expect(find.textContaining('4-digit Ride PIN'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Start trip')).onPressed, isNull);
    for (final d in ['4', '8', '2', '1']) {
      await tester.tap(find.widgetWithText(FilledButton, d));
      await tester.pump();
    }
    await tester.tap(find.widgetWithText(FilledButton, 'Start trip'));
    await settle(tester, ms: 600);
    expect(api.bodies['POST /driver/rides/r1/start'], {'pin': '4821'});

    expect(find.text('Trip in progress'), findsWidgets);
    expect(find.textContaining('Collect Rs 565 cash'), findsOneWidget);
    await tester.tap(find.text('Complete trip'));
    await settle(tester, ms: 600);

    expect(find.text('Trip complete'), findsOneWidget);
    expect(find.text('Cash collected from rider'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.star_outline_rounded).at(4));
    await tester.pump();
    await tester.tap(find.text('Polite'));
    await tester.pump();
    await tester.scrollUntilVisible(find.text('Submit rating'), 200, scrollable: find.descendant(of: find.byType(CompletePanel), matching: find.byType(Scrollable)).first);
    await tester.tap(find.text('Submit rating'));
    await settle(tester, ms: 400);
    expect(api.bodies['POST /rides/r1/rating'], {'stars': 5, 'tags': ['POLITE']});
    expect(find.text('Thanks for rating'), findsOneWidget);
    await tester.tap(find.text('Back to driving'));
    await settle(tester, ms: 600);
    expect(find.text('You are online'), findsOneWidget);
  });

  testWidgets('a wallet-paid trip says there is no cash to collect', (tester) async {
    final api = FakeApi(offerOpen: true, paymentMethod: 'WALLET', rideStatus: 'IN_PROGRESS');
    await boot(tester, api);
    await tester.tap(find.text('Go online'));
    await settle(tester, ms: 1500);
    await tester.tap(find.text('Accept'));
    await settle(tester, ms: 800);
    api.rideStatus = 'IN_PROGRESS';
    await settle(tester, ms: 3500); // next poll picks up the new state
    await tester.tap(find.text('Complete trip'));
    await settle(tester, ms: 600);
    expect(find.text('Paid in the app'), findsOneWidget);
  });

  testWidgets('a rider cancelling shows the cancelled state and frees the driver', (tester) async {
    final api = await boot(tester, FakeApi(offerOpen: true));
    await tester.tap(find.text('Go online'));
    await settle(tester, ms: 1500);
    await tester.tap(find.text('Accept'));
    await settle(tester, ms: 800);
    api.rideStatus = 'CANCELLED';
    await settle(tester, ms: 3500); // next poll
    expect(find.textContaining('rider cancelled'), findsOneWidget);
    await tester.tap(find.text('Back to driving'));
    await settle(tester, ms: 600);
    expect(find.text('Go offline'), findsOneWidget);
  });

  testWidgets('driver can cancel with a reason', (tester) async {
    final api = await boot(tester, FakeApi(offerOpen: true));
    await tester.tap(find.text('Go online'));
    await settle(tester, ms: 1500);
    await tester.tap(find.text('Accept'));
    await settle(tester, ms: 800);
    await tester.tap(find.text('Cancel trip'));
    await settle(tester, ms: 500);
    await tester.tap(find.text('Rider did not show up'));
    await settle(tester, ms: 800);
    expect(api.bodies['POST /driver/rides/r1/cancel'], {'reason': 'PASSENGER_NO_SHOW'});
    expect(find.text('Go offline'), findsOneWidget);
  });

  testWidgets('SOS during a trip sends the alert and confirms', (tester) async {
    final api = await boot(tester, FakeApi(offerOpen: true));
    await tester.tap(find.text('Go online'));
    await settle(tester, ms: 1500);
    await tester.tap(find.text('Accept'));
    await settle(tester, ms: 800);
    await tester.tap(find.text('SOS'));
    await settle(tester, ms: 500);
    await tester.tap(find.text('Send SOS now'));
    await settle(tester, ms: 500);
    expect(api.calls, contains('POST /rides/r1/sos'));
    expect(find.text('SOS sent'), findsOneWidget);
    expect(find.textContaining('2 trusted contact'), findsOneWidget);
  });

  testWidgets('PIN pad enters, deletes and caps digits', (tester) async {
    var v = '';
    await tester.pumpWidget(MaterialApp(home: StatefulBuilder(builder: (c, set) => Scaffold(body: PinPad(value: v, onChanged: (n) => set(() => v = n))))));
    for (final d in ['1', '2', '3', '4', '5']) {
      await tester.tap(find.widgetWithText(FilledButton, d));
      await tester.pump();
    }
    expect(v, '1234');
    await tester.tap(find.byIcon(Icons.backspace_outlined));
    await tester.pump();
    expect(v, '123');
    await tester.tap(find.text('Clear'));
    await tester.pump();
    expect(v, '');
  });
}
