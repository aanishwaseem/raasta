// Contract check against a running, seeded API. Skipped unless RAASTA_LIVE_API is set:
//   RAASTA_LIVE_API=http://localhost:3000/api/v1 flutter test test/live_api_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:raasta_core/raasta_core.dart';

void main() {
  final url = Platform.environment['RAASTA_LIVE_API'];

  test('passenger + driver flows used by the apps work end to end', () async {
    ApiClient mk() => ApiClient(baseUrl: url!, store: MemorySessionStore());
    final pax = mk();
    final drv = mk();
    await pax.login('bilal@raasta.test', 'Passw0rd!test', requiredRole: 'PASSENGER');
    await drv.login('usman@raasta.test', 'Passw0rd!test', requiredRole: 'DRIVER');

    final places = await pax.get('/places/search', query: {'q': 'Emporium'}) as List;
    final to = places.first['location'];
    await drv.post('/driver/online', body: {'lat': 31.5105, 'lng': 74.3432});

    final quote = await pax.post('/rides/quotes', body: {
      'pickup': {'lat': 31.5102, 'lng': 74.3441, 'address': 'Liberty Market'},
      'dropoff': {'lat': to['lat'], 'lng': to['lng'], 'address': 'Emporium'},
    });
    final opt = (quote['options'] as List).firstWhere((o) => o['productCode'] == 'ECONOMY');
    final ride = await pax.post('/rides', body: {'quoteId': quote['id'], 'productCode': opt['productCode'], 'paymentMethod': 'CASH'}, idempotencyKey: ApiClient.newIdempotencyKey());

    Map? offer;
    for (var i = 0; i < 20 && offer == null; i++) {
      final o = await drv.get('/driver/offers/current');
      if (o is Map) { offer = o; } else { await Future<void>.delayed(const Duration(milliseconds: 500)); }
    }
    expect(offer, isNotNull, reason: 'driver should receive the offer');
    expect(offer!['rideId'], ride['id']);
    await drv.post('/driver/offers/${offer['offerId']}/accept');

    final pv = await pax.get('/rides/${ride['id']}');
    expect(pv['pin'], isNotNull);
    final pickup = pv['pickup'];
    await drv.post('/driver/location', body: {'lat': pickup['lat'], 'lng': pickup['lng']});
    await drv.post('/driver/location', body: {'lat': pickup['lat'], 'lng': pickup['lng']});
    await drv.post('/driver/rides/${ride['id']}/arrived');
    await drv.post('/driver/rides/${ride['id']}/start', body: {'pin': pv['pin']});
    final d = pv['dropoff'];
    await drv.post('/driver/location', body: {'lat': d['lat'], 'lng': d['lng']});
    await drv.post('/driver/rides/${ride['id']}/complete', body: {'lat': d['lat'], 'lng': d['lng']}, idempotencyKey: 'complete-${ride['id']}');
    final done = await pax.get('/rides/${ride['id']}');
    expect(done['status'], 'COMPLETED');
    await pax.post('/rides/${ride['id']}/rating', body: {'stars': 5});
    expect(((await pax.get('/rides', query: {'pageSize': '5'}))['items'] as List).isNotEmpty, isTrue);
    final earn = await drv.get('/driver/earnings');
    expect(earn['trips'], greaterThan(0));
    await drv.post('/driver/offline');
  }, skip: url == null ? 'set RAASTA_LIVE_API to run' : false);

  test('phone code sign-in creates a rider and signs in (needs OTP_DEV_ECHO=true on the API)', () async {
    final api = ApiClient(baseUrl: url!, store: MemorySessionStore());
    final phone = '+92301${DateTime.now().millisecondsSinceEpoch.toString().substring(6)}';
    final r = await api.requestOtp(phone);
    expect(r['devCode'], isNotNull, reason: 'start the API with OTP_DEV_ECHO=true');
    final s = await api.verifyOtp(phone, r['devCode'] as String, fullName: 'Code Rider', requiredRole: 'PASSENGER');
    expect(s.roles, contains('PASSENGER'));
    expect(await api.get('/wallet'), isA<Map>());
  }, skip: url == null ? 'set RAASTA_LIVE_API to run' : false);
}
