import 'package:driver_app/main.dart';
import 'package:driver_app/widgets/bar_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

Future<FakeApi> boot(WidgetTester tester, [FakeApi? fake]) async {
  final api = fake ?? FakeApi();
  phone(tester);
  await tester.pumpWidget(DriverApp(api: api.client(), location: FixedLocation()));
  await settle(tester);
  await signIn(tester);
  return api;
}

void main() {
  testWidgets('earnings tab shows the breakdown, efficiency and a chart for the week', (tester) async {
    final api = await boot(tester);
    await openTab(tester, 'Earnings');
    expect(find.text('Rs 6,450'), findsOneWidget); // take-home after fuel estimate
    expect(find.text('Gross fares'), findsOneWidget);
    expect(find.text('Fuel (estimate)'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Idle time'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Earnings per hour'), findsOneWidget);
    expect(find.byType(BarChart), findsNothing); // today view has no daily chart

    await tester.tap(find.text('7 days'));
    await settle(tester, ms: 600);
    await tester.scrollUntilVisible(find.text('Trips per day'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.byType(BarChart), findsWidgets);
    expect(api.calls.where((c) => c == 'GET /driver/earnings').length, 2);
  });

  testWidgets('earnings are honest about rates the server does not provide', (tester) async {
    await boot(tester);
    await openTab(tester, 'Earnings');
    await tester.scrollUntilVisible(find.text('Rates not available yet'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Rates not available yet'), findsOneWidget);
  });

  testWidgets('demand tab lists zones with levels and frames advice as a prediction', (tester) async {
    await boot(tester);
    await openTab(tester, 'Demand');
    expect(find.text('Copilot suggestions'), findsOneWidget);
    expect(find.textContaining('predicted to be high'), findsOneWidget);
    expect(find.textContaining('not a promise'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('DHA'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('High'), findsWidgets);
  });

  testWidgets('wallet shows balances and transactions; withdrawal is validated then sent', (tester) async {
    final api = await boot(tester);
    await openTab(tester, 'Wallet');
    expect(find.text('Available balance'), findsOneWidget);
    expect(find.text('Rs 3,200'), findsWidgets);
    expect(find.text('Pending'), findsOneWidget);
    expect(find.text('Trip earnings'), findsOneWidget);

    await tester.tap(find.text('Withdraw'));
    await settle(tester, ms: 500);
    await tester.enterText(find.byType(TextFormField).at(0), '100');
    await tester.enterText(find.byType(TextFormField).at(1), '123');
    await tester.tap(find.text('Request withdrawal'));
    await tester.pump();
    expect(find.text('Minimum withdrawal is Rs 500'), findsOneWidget);
    expect(find.text('Enter 8 to 34 characters'), findsOneWidget);
    expect(api.calls, isNot(contains('POST /driver/withdrawals')));

    await tester.enterText(find.byType(TextFormField).at(0), '1500');
    await tester.enterText(find.byType(TextFormField).at(1), '03001234567');
    await tester.enterText(find.byType(TextFormField).at(2), 'Usman Tariq');
    await tester.tap(find.text('Request withdrawal'));
    await settle(tester, ms: 600);
    expect(api.bodies['POST /driver/withdrawals'], {'amount': 1500, 'method': 'JAZZCASH', 'accountNumber': '03001234567', 'accountTitle': 'Usman Tariq'});
    expect(find.textContaining('Withdrawal requested'), findsOneWidget);
  });

  testWidgets('profile shows status chips, a data-backed badge, preferences and sign out', (tester) async {
    final api = await boot(tester);
    await openTab(tester, 'Profile');
    expect(find.text('Usman Tariq'), findsOneWidget);
    expect(find.text('Verified Driver'), findsOneWidget);
    expect(find.text('High Completion Reliability'), findsNothing); // no data to back it
    expect(find.text('Rejected'), findsOneWidget);
    expect(find.textContaining('Photo is blurry'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Accept shared rides'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Accept shared rides'));
    await settle(tester, ms: 400);
    expect(api.bodies['PATCH /driver/preferences'], {'acceptShared': false});
    await tester.scrollUntilVisible(find.text('Sign out'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Sign out'));
    await settle(tester, ms: 400);
    expect(find.text('Stay'), findsOneWidget);
  });

  testWidgets('intercity and support open from the profile with empty states', (tester) async {
    await boot(tester);
    await openTab(tester, 'Profile');
    await tester.scrollUntilVisible(find.text('Intercity trips'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Intercity trips'));
    await settle(tester, ms: 600);
    expect(find.text('No intercity trips yet'), findsOneWidget);
    await tester.pageBack();
    await settle(tester, ms: 600);
    await tester.tap(find.text('Support'));
    await settle(tester, ms: 600);
    expect(find.text('No support tickets'), findsOneWidget);
  });

  testWidgets('a failing tab shows a friendly error with retry, never a raw exception, and recovers', (tester) async {
    final api = FakeApi();
    await boot(tester, api);
    api.failing.add('/driver/wallet');
    await openTab(tester, 'Wallet');
    expect(find.text('Try again'), findsOneWidget);
    expect(find.textContaining('boom'), findsNothing);
    expect(find.textContaining('Exception'), findsNothing);
    api.failing.clear();
    await tester.tap(find.text('Try again'));
    await settle(tester, ms: 600);
    expect(find.text('Available balance'), findsOneWidget);
  });

  testWidgets('losing the network shows a banner while online', (tester) async {
    final api = await boot(tester);
    await tester.tap(find.text('Go online'));
    await settle(tester, ms: 800);
    expect(find.textContaining('No connection'), findsNothing);
    api.networkDown = true;
    await settle(tester, ms: 3500);
    expect(find.textContaining('No connection'), findsOneWidget);
    expect(find.text('You are online'), findsOneWidget);
    api.networkDown = false;
    await tester.tap(find.text('Retry'));
    await settle(tester, ms: 600);
    expect(find.textContaining('No connection'), findsNothing);
  });
}
