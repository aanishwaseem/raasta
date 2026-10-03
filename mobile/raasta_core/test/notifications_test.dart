import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:raasta_core/raasta_core.dart';

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

Future<ApiClient> client(List<String> calls, {bool fail = false}) async {
  final items = [
    {'id': 'n1', 'type': 'RIDE_DRIVER_ASSIGNED', 'title': 'Driver found', 'body': 'Usman is on the way', 'readAt': null, 'createdAt': DateTime.now().toUtc().toIso8601String()},
    {'id': 'n2', 'type': 'PAYMENT_UPDATED', 'title': 'Paid', 'body': 'Rs 450 paid', 'readAt': '2026-09-01T10:00:00Z', 'createdAt': '2026-09-01T10:00:00Z'},
  ];
  final api = ApiClient(
    baseUrl: 'http://x/api/v1',
    store: MemorySessionStore(),
    client: MockClient((req) async {
      calls.add('${req.method} ${req.url.path}');
      if (req.url.path.endsWith('/auth/login')) return json({'user': {'fullName': 'B', 'roles': ['PASSENGER']}, 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}});
      if (fail) return json({'error': {'code': 'SERVER', 'message': 'boom'}}, 500);
      if (req.url.path.endsWith('/me/notifications')) return json({'items': items, 'page': 1, 'pageSize': 50, 'total': 2, 'unread': 1});
      return http.Response('', 204);
    }),
  );
  await api.login('b@x.test', 'pw', requiredRole: 'PASSENGER');
  return api;
}

void main() {
  sessionsTests();
  test('timeAgo gives short human labels', () {
    final now = DateTime(2026, 10, 2, 12);
    expect(timeAgo(now.subtract(const Duration(seconds: 20)), now: now), 'Just now');
    expect(timeAgo(now.subtract(const Duration(minutes: 5)), now: now), '5 min ago');
    expect(timeAgo(now.subtract(const Duration(hours: 3)), now: now), '3 h ago');
    expect(timeAgo(now.subtract(const Duration(days: 2)), now: now), '2 d ago');
  });

  testWidgets('centre lists notifications, marks one read on tap and all read on request', (tester) async {
    final calls = <String>[];
    final api = await client(calls);
    await tester.pumpWidget(MaterialApp(home: NotificationsScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.text('Driver found'), findsOneWidget);
    expect(find.text('Mark all read'), findsOneWidget);
    await tester.tap(find.text('Driver found'));
    await tester.pumpAndSettle();
    expect(calls, contains('POST /api/v1/me/notifications/n1/read'));
    expect(find.text('Mark all read'), findsNothing); // unread count dropped to zero
  });

  testWidgets('shows a friendly error with retry when the server fails (no raw error text)', (tester) async {
    final api = await client([], fail: true);
    await tester.pumpWidget(MaterialApp(home: NotificationsScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.text('Try again'), findsOneWidget);
    expect(find.textContaining('boom'), findsNothing);
  });

  testWidgets('bell shows the unread badge', (tester) async {
    final api = await client([]);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: NotificationBell(api: api))));
    await tester.pumpAndSettle();
    expect(find.text('1'), findsOneWidget);
  });
}

void sessionsTests() {
  testWidgets('signed-in devices: lists sessions, hides sign-out for this device, revokes another after confirmation', (tester) async {
    final calls = <String>[];
    var revoked = false;
    final api = ApiClient(
      baseUrl: 'http://x/api/v1',
      store: MemorySessionStore(),
      client: MockClient((req) async {
        calls.add('${req.method} ${req.url.path}');
        if (req.url.path.endsWith('/auth/login')) return json({'user': {'fullName': 'B', 'roles': ['PASSENGER']}, 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}});
        if (req.method == 'DELETE') { revoked = true; return http.Response('', 204); }
        return json([
          {'id': 's1', 'deviceName': 'Pixel 7', 'platform': 'android', 'lastUsedAt': DateTime.now().toUtc().toIso8601String(), 'current': true},
          if (!revoked) {'id': 's2', 'deviceName': 'Old tablet', 'platform': 'android', 'lastUsedAt': '2026-09-01T10:00:00Z', 'current': false},
        ]);
      }),
    );
    await api.login('b@x.test', 'pw', requiredRole: 'PASSENGER');
    await tester.pumpWidget(MaterialApp(home: SessionsScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.textContaining('(this device)'), findsOneWidget);
    expect(find.byTooltip('Sign out this device'), findsOneWidget);
    await tester.tap(find.byTooltip('Sign out this device'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sign out'));
    await tester.pumpAndSettle();
    expect(calls, contains('DELETE /api/v1/auth/sessions/s2'));
    expect(find.text('Old tablet'), findsNothing);
  });
}
