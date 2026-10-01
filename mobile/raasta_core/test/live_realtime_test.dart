// Checks the websocket push channel against a running, seeded API. Skipped unless RAASTA_LIVE_API is set.
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:raasta_core/raasta_core.dart';

void main() {
  final url = Platform.environment['RAASTA_LIVE_API'];

  test('passenger receives a push when the driver accepts', () async {
    ApiClient mk() => ApiClient(baseUrl: url!, store: MemorySessionStore(), useRealtime: true);
    final pax = mk();
    final drv = mk();
    await pax.login('bilal@raasta.test', 'Passw0rd!test', requiredRole: 'PASSENGER');
    await drv.login('usman@raasta.test', 'Passw0rd!test', requiredRole: 'DRIVER');
    await drv.post('/driver/online', body: {'lat': 31.5105, 'lng': 74.3432});

    final quote = await pax.post('/rides/quotes', body: {
      'pickup': {'lat': 31.5102, 'lng': 74.3441, 'address': 'Liberty Market'},
      'dropoff': {'lat': 31.5497, 'lng': 74.3436, 'address': 'Emporium'},
    });
    // the driver should be pushed the offer before any polling happens
    final drt = drv.realtime()!;
    final offerPush = Completer<String>();
    drt.events.listen((e) { if (e == 'ride.offer' && !offerPush.isCompleted) offerPush.complete(e); });
    addTearDown(drt.dispose);
    for (var i = 0; i < 20 && !drt.connected; i++) { await Future<void>.delayed(const Duration(milliseconds: 250)); }
    final ride = await pax.post('/rides', body: {'quoteId': quote['id'], 'productCode': 'ECONOMY', 'paymentMethod': 'CASH'}, idempotencyKey: ApiClient.newIdempotencyKey());

    final rt = pax.realtime(rideId: ride['id'] as String)!;
    final got = Completer<String>();
    rt.events.listen((e) { if (e == 'ride.driver_assigned' && !got.isCompleted) got.complete(e); });
    addTearDown(rt.dispose);
    for (var i = 0; i < 20 && !rt.connected; i++) { await Future<void>.delayed(const Duration(milliseconds: 250)); }
    expect(rt.connected, isTrue);

    expect(await offerPush.future.timeout(const Duration(seconds: 5)), 'ride.offer');
    Map? offer;
    for (var i = 0; i < 20 && offer == null; i++) {
      final o = await drv.get('/driver/offers/current');
      if (o is Map) { offer = o; } else { await Future<void>.delayed(const Duration(milliseconds: 500)); }
    }
    expect(offer, isNotNull);
    await drv.post('/driver/offers/${offer!['offerId']}/accept');
    expect(await got.future.timeout(const Duration(seconds: 5)), 'ride.driver_assigned');

    await pax.post('/rides/${ride['id']}/cancel', body: {'reason': 'CHANGED_MIND'});
  }, skip: url == null ? 'set RAASTA_LIVE_API to run' : false);
}
