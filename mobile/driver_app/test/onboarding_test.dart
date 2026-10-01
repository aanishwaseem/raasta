import 'package:driver_app/main.dart';
import 'package:driver_app/widgets/onboarding_stepper.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

Map<String, dynamic> meWith(String status, List<List<String>> items, {String? notes, bool canGoOnline = false}) => {
      'status': status,
      'canGoOnline': canGoOnline,
      'reviewNotes': notes,
      'checklist': [for (final i in items) {'key': i[0], 'label': i[1], 'status': i[2], if (i.length > 3) 'note': i[3]}],
    };

Future<FakeApi> boot(WidgetTester tester, Map<String, dynamic> me) async {
  final api = FakeApi(me: me);
  phone(tester);
  await tester.pumpWidget(DriverApp(api: api.client(), location: FixedLocation()));
  await settle(tester);
  await signIn(tester);
  return api;
}

void main() {
  testWidgets('a new driver sees the stepper and checklist and cannot submit yet', (tester) async {
    await boot(tester, meWith('ONBOARDING', [['IDENTITY', 'Identity (CNIC & licence)', 'MISSING'], ['CNIC_FRONT', 'CNIC (front)', 'MISSING'], ['VEHICLE', 'Vehicle details', 'MISSING'], ['REVIEW', 'Review by Raasta team', 'MISSING'], ['TRAINING', 'Safety & code of conduct', 'MISSING']]));
    expect(find.text('Become a driver'), findsOneWidget);
    for (final s in ['Register', 'Identity', 'Documents', 'Vehicle', 'Review', 'Training', 'Activate']) {
      expect(find.text(s), findsOneWidget, reason: 'step $s');
    }
    expect(find.text('Identity (CNIC & licence)'), findsOneWidget);
    expect(find.text('Safety & code of conduct'), findsNothing);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit for review')).onPressed, isNull);
  });

  testWidgets('submit is enabled once everything is done or waiting for review', (tester) async {
    await boot(tester, meWith('ONBOARDING', [['IDENTITY', 'Identity (CNIC & licence)', 'DONE'], ['CNIC_FRONT', 'CNIC (front)', 'PENDING'], ['VEHICLE', 'Vehicle details', 'PENDING'], ['REVIEW', 'Review by Raasta team', 'MISSING'], ['TRAINING', 'Safety & code of conduct', 'MISSING']]));
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit for review')).onPressed, isNotNull);
  });

  testWidgets('a rejected application shows the reviewer reason and the rejected document', (tester) async {
    await boot(tester, meWith('REJECTED', [['IDENTITY', 'Identity (CNIC & licence)', 'DONE'], ['CNIC_FRONT', 'CNIC (front)', 'REJECTED', 'Photo is blurry'], ['REVIEW', 'Review by Raasta team', 'REJECTED']], notes: 'Please upload a clear CNIC.'));
    expect(find.text('Your application needs changes'), findsOneWidget);
    expect(find.text('Please upload a clear CNIC.'), findsOneWidget);
    expect(find.textContaining('Photo is blurry'), findsOneWidget);
    expect(find.text('Replace'), findsOneWidget); // can fix it
  });

  testWidgets('an application in review shows a waiting notice and no submit button', (tester) async {
    await boot(tester, meWith('PENDING_REVIEW', [['IDENTITY', 'Identity (CNIC & licence)', 'DONE'], ['REVIEW', 'Review by Raasta team', 'PENDING']]));
    expect(find.text('Application in review'), findsOneWidget);
    expect(find.text('Submit for review'), findsNothing);
  });

  testWidgets('an approved driver acknowledges the code of conduct to activate', (tester) async {
    final api = await boot(tester, meWith('APPROVED', [['IDENTITY', 'Identity (CNIC & licence)', 'DONE'], ['REVIEW', 'Review by Raasta team', 'APPROVED'], ['TRAINING', 'Safety & code of conduct', 'MISSING']]));
    expect(find.text('You are approved'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Start driving')).onPressed, isNull);
    await tester.ensureVisible(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Start driving'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Start driving'));
    await settle(tester, ms: 400);
    expect(api.calls, contains('POST /driver/onboarding/training'));
  });

  test('stepper marks the first unfinished step as current and rejected ones as errors', () {
    final steps = onboardingSteps(meWith('ONBOARDING', [['IDENTITY', 'i', 'DONE'], ['CNIC_FRONT', 'c', 'REJECTED'], ['VEHICLE', 'v', 'MISSING']]));
    expect(steps.map((s) => s.kind).toList(), [StepKind.done, StepKind.done, StepKind.error, StepKind.todo, StepKind.todo, StepKind.todo, StepKind.todo]);
  });
}
