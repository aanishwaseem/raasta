import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:raasta_core/raasta_core.dart';

http.Response j(Object? b, [int s = 200]) => http.Response(jsonEncode(b), s, headers: {'content-type': 'application/json'});

class FixedLocation extends DeviceLocation {
  @override
  Future<Fix> current() async => const Fix(31.5105, 74.3432);
}

/// Pretends GPS is off or permission was denied.
class NoGps extends DeviceLocation {
  @override
  Future<Fix> current() async {
    lastProblem = 'Location is turned off on this device.';
    return const Fix(31.52, 74.35, approximate: true);
  }
}

/// A phone-sized screen so layouts are tested at a realistic width.
void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
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

Future<void> openTab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(label)));
  await settle(tester, ms: 600);
}

const approvedMe = {
  'id': 'd1', 'fullName': 'Usman Tariq', 'phone': '+923001234567', 'cnicLast4': '4567', 'status': 'APPROVED', 'canGoOnline': true,
  'preferences': {'acceptShared': true, 'maxPickupKm': 5},
  'vehicles': [{'id': 'v1', 'vehicleClass': 'ECONOMY', 'make': 'Suzuki', 'model': 'Cultus', 'year': 2019, 'color': 'White', 'plateNumber': 'LEA-19-1234', 'seats': 4, 'status': 'APPROVED', 'current': true}],
  'checklist': [],
};

/// Mutable fake backend so a whole trip can be walked through.
class FakeApi {
  FakeApi({this.me = approvedMe, this.roles = const ['DRIVER'], this.offerOpen = false, this.rideStatus = 'DRIVER_ASSIGNED', this.paymentMethod = 'CASH'});
  Map<String, dynamic> me;
  List<String> roles;
  bool offerOpen;
  String rideStatus;
  String paymentMethod;
  final failing = <String>{}; // paths that answer 500
  bool networkDown = false; // every request fails like a dropped connection
  final calls = <String>[];
  final bodies = <String, Object?>{};

  Map<String, dynamic> get ride => {
        'id': 'r1', 'status': rideStatus, 'paymentMethod': paymentMethod, 'distanceM': 12888, 'route': [],
        'pickup': {'lat': 31.51, 'lng': 74.34, 'address': 'Liberty Market'},
        'dropoff': {'lat': 31.48, 'lng': 74.38, 'address': 'Emporium Mall'},
        'fare': {'payable': 565, 'final': rideStatus == 'COMPLETED' ? 565 : null},
        'passenger': {'firstName': 'Ayesha', 'rating': 4.9}, 'etas': {'pickupEtaS': 240},
        'cancellation': rideStatus == 'CANCELLED' ? {'by': 'PASSENGER', 'reason': 'CHANGED_MIND'} : null,
        'myRating': null,
      };

  ApiClient client() => ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore(), client: MockClient(_handle));

  Future<http.Response> _handle(http.Request req) async {
    final p = req.url.path.replaceFirst('/api/v1', '');
    if (networkDown && p != '/auth/login') throw http.ClientException('offline');
    calls.add('${req.method} $p');
    if (failing.contains(p)) return j({'error': {'code': 'INTERNAL', 'message': 'boom: stack trace'}}, 500);
    if (req.body.isNotEmpty) bodies['${req.method} $p'] = jsonDecode(req.body);
    if (p == '/auth/login') return j({'user': {'fullName': 'Usman Tariq', 'roles': roles}, 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}});
    if (p == '/driver/me') return j(me);
    if (p == '/driver/rides/active') return j([]);
    if (p == '/driver/online') return j({'status': 'IDLE'});
    if (p == '/driver/offline') return j({'online': false});
    if (p == '/driver/location') return j({'ok': true});
    if (p == '/driver/copilot') {
      return j({
        'online': false,
        'today': {'trips': 3, 'net': 2400, 'onlineHours': 4.5, 'perHour': 533},
        'recommendations': [{'type': 'REPOSITION', 'title': 'High demand expected in Gulberg', 'detail': 'About 6 requests expected.', 'basis': 'Prediction from demand@1; not a guarantee of rides.', 'confidence': 'medium'}],
        'disclaimer': 'Copilot suggestions are predictions based on recent data. Earnings are never guaranteed.',
      });
    }
    if (p == '/driver/offers/current') {
      return offerOpen ? j({'offerId': 'o1', 'rideId': 'r1', 'fare': 565, 'pickupDistanceM': 800, 'pickupEtaS': 240, 'tripDistanceM': 12888, 'tripDurationS': 1500, 'paymentMethod': 'CASH', 'pickupAddress': 'Liberty Market', 'dropoffAddress': 'Emporium Mall', 'pickup': {'lat': 31.51, 'lng': 74.34}}) : http.Response('null', 200, headers: {'content-type': 'application/json'});
    }
    if (p == '/driver/offers/o1/accept') { offerOpen = false; rideStatus = 'DRIVER_ASSIGNED'; return j({'rideId': 'r1'}); }
    if (p == '/driver/offers/o1/decline') { offerOpen = false; return j({'ok': true}); }
    if (p == '/rides/r1') return j(ride);
    if (p == '/driver/rides/r1/arrived') { rideStatus = 'DRIVER_ARRIVED'; return j(ride); }
    if (p == '/driver/rides/r1/start') { rideStatus = 'IN_PROGRESS'; return j(ride); }
    if (p == '/driver/rides/r1/complete') { rideStatus = 'COMPLETED'; return j(ride); }
    if (p == '/driver/rides/r1/cancel') { rideStatus = 'CANCELLED'; return j(ride); }
    if (p == '/rides/r1/rating') return j({'ok': true});
    if (p == '/rides/r1/sos') return j({'eventId': 'e1', 'status': 'ESCALATED', 'contactsNotified': 2, 'emergencyNumber': '15'});
    if (p == '/driver/earnings') {
      return j({'trips': 12, 'gross': 9000, 'platformFees': 1350, 'cancellationFeesEarned': 0, 'net': 7650, 'fuelEstimate': 1200, 'netAfterFuelEstimate': 6450, 'distanceKm': 120.5, 'onlineHours': 20, 'busyHours': 12, 'idleHours': 8, 'perHour': 383, 'perKm': 63, 'daily': [{'date': '2026-09-29', 'trips': 4, 'net': 2500, 'onlineHours': 6}, {'date': '2026-09-30', 'trips': 5, 'net': 3100, 'onlineHours': 7}, {'date': '2026-10-01', 'trips': 3, 'net': 2050, 'onlineHours': 7}], 'notes': ['Fuel cost is an estimate.']});
    }
    if (p == '/driver/demand') {
      return j({'disclaimer': 'Demand levels are predictions for the next hour, not guarantees.', 'zones': [
        {'zoneId': 'z1', 'name': 'Gulberg', 'centroid': {'lat': 31.52, 'lng': 74.35}, 'level': 'HIGH', 'expectedRequests': 6.4, 'onlineDrivers': 2},
        {'zoneId': 'z2', 'name': 'DHA', 'centroid': {'lat': 31.48, 'lng': 74.40}, 'level': 'LOW', 'expectedRequests': 1.2, 'onlineDrivers': 5},
      ]});
    }
    if (p == '/driver/wallet') return j({'available': 3200, 'pending': 450, 'outstanding': 0});
    if (p == '/driver/wallet/transactions') return j({'items': [{'id': '1', 'kind': 'RIDE_EARNING', 'description': 'Trip earnings', 'bucket': 'AVAILABLE', 'amount': 480, 'createdAt': '2026-10-01T08:00:00Z'}, {'id': '2', 'kind': 'WITHDRAWAL', 'description': 'Payout', 'bucket': 'AVAILABLE', 'amount': -1000, 'createdAt': '2026-09-30T08:00:00Z'}]});
    if (p == '/driver/withdrawals') return j({'id': 'w1', 'status': 'PENDING'});
    if (p == '/driver/documents') {
      return j([{'id': 'a', 'docType': 'CNIC_FRONT', 'status': 'APPROVED'}, {'id': 'b', 'docType': 'INSURANCE', 'status': 'REJECTED', 'rejectionReason': 'Photo is blurry'}]);
    }
    if (p == '/driver/preferences') return j(me);
    if (p == '/driver/intercity/trips') return j([]);
    if (p == '/support/tickets') return j({'items': []});
    return j({'error': {'code': 'NOT_FOUND', 'message': 'x'}}, 404);
  }
}
