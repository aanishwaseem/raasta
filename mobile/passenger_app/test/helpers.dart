import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:passenger_app/main.dart';
import 'package:raasta_core/raasta_core.dart';

class FixedLocation extends DeviceLocation {
  @override
  Future<Fix> current() async => const Fix(31.5102, 74.3441);
}

http.Response j(Object? b, [int s = 200]) => http.Response(jsonEncode(b), s, headers: {'content-type': 'application/json'});

http.Response err(int status, String code, String message) => j({'error': {'code': code, 'message': message}}, status);

typedef Handler = http.Response Function(http.Request req);

/// Tiny router over MockClient: routes are "METHOD /path" with ":id" wildcards; the first match wins.
class FakeServer {
  FakeServer(Map<String, Handler> routes) {
    // Test routes first, then defaults for anything not overridden.
    _routes..addAll(routes.entries)..addAll(_defaults().entries.where((e) => !routes.containsKey(e.key)));
    // Literal paths win over ':id' wildcards so /rides/active is never swallowed by /rides/:id.
    _routes.sort((a, b) => (a.key.contains(':') ? 1 : 0) - (b.key.contains(':') ? 1 : 0));
  }
  final _routes = <MapEntry<String, Handler>>[];
  final calls = <String>[];
  final bodies = <String, Object?>{};
  final headers = <String, Map<String, String>>{};
  final queries = <String, Map<String, String>>{};

  static Map<String, Handler> _defaults() => {
        'GET /rides/active': (_) => j(<String, dynamic>{}),
        'GET /me': (_) => j({'fullName': 'Bilal Ahmed', 'phone': '+923001112233', 'email': 'bilal@raasta.test', 'referralCode': 'BILAL1', 'locale': 'en', 'gender': 'MALE'}),
        'GET /me/places': (_) => j([{'id': 'p1', 'label': 'HOME', 'name': 'Home', 'address': 'Gulberg III, Lahore', 'location': {'lat': 31.51, 'lng': 74.34}}]),
        'GET /me/stats': (_) => j({'completedRides': 12, 'distanceKm': 140, 'totalSpent': 9000, 'cancelledRides': 1, 'promoSavings': 300, 'currency': 'PKR'}),
        'GET /rides': (_) => j({'items': [], 'page': 1, 'pageSize': 20, 'total': 0}),
        'GET /me/suggestions': (_) => j([]),
        'GET /scheduled-rides': (_) => j([]),
        'GET /places/reverse': (_) => j({'name': 'Liberty Market', 'address': 'Liberty Market, Lahore'}),
        'GET /places/search': (_) => j([{'id': '1', 'name': 'Emporium Mall', 'address': 'Johar Town, Lahore', 'location': {'lat': 31.46, 'lng': 74.26}}]),
        'GET /me/emergency-contacts': (_) => j([{'id': 'c1', 'name': 'Ayesha', 'phone': '+923001234567', 'relationship': 'Sister', 'shareByDefault': true}]),
        'GET /me/preferences': (_) => j({'safety': {'autoShareWithContacts': false, 'routeDeviationAlerts': true, 'preferFemaleDriver': false}, 'notifications': {'push': true, 'sms': false, 'email': true, 'marketing': false}, 'personalizationEnabled': true}),
        'GET /wallet': (_) => j({'walletId': 'w', 'currency': 'PKR', 'available': 1500, 'pending': 0, 'outstanding': 0}),
        'GET /wallet/transactions': (_) => j({'items': [{'id': 1, 'kind': 'TOPUP', 'description': 'Wallet top-up Rs 2000', 'amount': 2000, 'createdAt': '2026-09-30T10:00:00Z'}], 'page': 1, 'pageSize': 20, 'total': 1}),
        'GET /payment-methods': (_) => j([{'id': 'm1', 'provider': 'mock', 'brand': 'Visa', 'last4': '4242', 'isDefault': true}]),
      };

  MockClient get client => MockClient((req) async {
        final path = req.url.path.replaceFirst('/api/v1', '');
        final key = '${req.method} $path';
        calls.add(key);
        if (req.body.isNotEmpty) bodies[key] = jsonDecode(req.body);
        headers[key] = req.headers;
        queries[key] = req.url.queryParameters;
        for (final e in _routes) {
          final parts = e.key.split(' ');
          if (parts[0] != req.method) continue;
          if (RegExp('^${parts[1].replaceAll(RegExp(r':\w+'), '[^/]+')}\$').hasMatch(path)) return e.value(req);
        }
        return err(404, 'NOT_FOUND', 'Not found');
      });

  bool called(String key) => calls.contains(key);
}

const quote = {
  'id': 'q1',
  'expiresAt': '2099-01-01T00:00:00Z',
  'distanceM': 12888,
  'durationS': 1555,
  'route': [[31.51, 74.34], [31.46, 74.26]],
  'context': {'demandLevel': 'HIGH', 'zoneName': 'Johar Town', 'routingProvider': 'osrm'},
  'recommendations': [
    {'kind': 'CHEAPEST', 'productCode': 'ECONOMY', 'fare': 565, 'pickupEtaS': 240, 'tripEtaS': 1500, 'reasons': ['Lowest fare for this trip']},
    {'kind': 'FASTEST', 'productCode': 'BIKE', 'fare': 300, 'pickupEtaS': 120, 'tripEtaS': 1200, 'reasons': []},
  ],
  'promo': null,
  'promoError': null,
  'options': [
    {'productCode': 'ECONOMY', 'name': 'Economy', 'description': 'Everyday rides', 'availability': 'GOOD', 'capacity': 4, 'isShared': false, 'pickupEtaS': 240, 'tripEtaS': 1500, 'fare': {'recommended': 565, 'payable': 565, 'discount': 0, 'minimumReasonable': 480, 'low': 480, 'high': 650, 'explanation': ['Standard fare: enough drivers are available nearby.'], 'breakdown': {'base': 100, 'distance': 300, 'time': 100, 'bookingFee': 65, 'demandAdjustment': 0, 'sharedDiscount': 0}, 'expectedMatchSeconds': {'atRecommended': 60, 'atMinimum': 120}}},
    {'productCode': 'BIKE', 'name': 'Bike', 'description': 'Fast through traffic', 'availability': 'LIMITED', 'capacity': 1, 'isShared': false, 'pickupEtaS': 120, 'tripEtaS': 1200, 'fare': {'recommended': 300, 'payable': 300, 'discount': 0, 'minimumReasonable': 250, 'low': 250, 'high': 350, 'explanation': [], 'breakdown': {}}},
  ],
};

Map<String, dynamic> rideView(String status, {String? pin, Map<String, dynamic>? extra}) => {
      'id': 'r1',
      'status': status,
      'productName': 'Economy',
      'pickup': {'lat': 31.51, 'lng': 74.34, 'address': 'Liberty Market, Lahore'},
      'dropoff': {'lat': 31.46, 'lng': 74.26, 'address': 'Emporium Mall, Johar Town'},
      'route': [[31.51, 74.34], [31.46, 74.26]],
      'fare': {'recommended': 565, 'offered': 565, 'discount': 0, 'payable': 565, 'final': status == 'COMPLETED' ? 565 : null, 'cancellationFee': 0},
      'paymentMethod': 'CASH',
      'paymentStatus': 'PENDING',
      'pin': pin,
      'driver': status == 'MATCHING' ? null : {'id': 'd1', 'firstName': 'Usman', 'rating': 4.9, 'ratingCount': 210, 'badges': [], 'vehicle': {'make': 'Suzuki', 'model': 'Alto', 'color': 'White', 'plateNumber': 'LEA-1234'}, 'location': {'lat': 31.5, 'lng': 74.33, 'heading': 0}},
      'etas': {'pickupEtaS': 300, 'tripEtaS': 1500},
      'matchAttempt': 1,
      'timestamps': {'requestedAt': '2026-10-01T10:00:00Z', 'assignedAt': status == 'MATCHING' ? null : '2026-10-01T10:01:00Z'},
      'myRating': null,
      ...?extra,
    };

/// Bounded pumps: maps keep animating while tiles load, so pumpAndSettle would never finish.
Future<void> settle(WidgetTester t, [int ms = 1200]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

void phone(WidgetTester t) {
  t.view.physicalSize = const Size(420, 900);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  // flutter_map's attribution label overflows with the test font (Ahem is very wide); ignore only that, so real overflows still fail.
  final orig = FlutterError.onError;
  FlutterError.onError = (d) {
    final s = d.toString();
    if (s.contains('flutter_map') && s.contains('overflowed')) return;
    orig?.call(d);
  };
  addTearDown(() => FlutterError.onError = orig);
}

/// Opens the app already signed in, with the given routes layered over sensible defaults.
Future<FakeServer> openApp(WidgetTester tester, [Map<String, Handler> routes = const {}]) async {
  phone(tester);
  final server = FakeServer(routes);
  final store = MemorySessionStore();
  await store.write(const Session(accessToken: 'a', refreshToken: 'r', name: 'Bilal Ahmed', roles: ['PASSENGER']));
  final api = ApiClient(baseUrl: 'http://x/api/v1', store: store, client: server.client);
  await tester.pumpWidget(PassengerApp(api: api, location: FixedLocation()));
  await settle(tester);
  return server;
}
