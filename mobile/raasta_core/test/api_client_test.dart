import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:raasta_core/raasta_core.dart';

Map<String, dynamic> loginBody({List<String> roles = const ['PASSENGER']}) => {
      'user': {'fullName': 'Bilal', 'roles': roles},
      'tokens': {'accessToken': 'a1', 'refreshToken': 'r1', 'expiresIn': 900},
    };

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

void main() {
  referralTest();
  retryTests();
  serverUrlTests();
  test('login stores the session and rejects the wrong role', () async {
    final api = ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore(), client: MockClient((_) async => json(loginBody())));
    final s = await api.login('b@x.test', 'pw', requiredRole: 'PASSENGER');
    expect(s.accessToken, 'a1');
    expect(api.session?.name, 'Bilal');
    await expectLater(api.login('b@x.test', 'pw', requiredRole: 'DRIVER'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'WRONG_APP')));
  });

  test('a 401 triggers one refresh, then the request is retried with the new token', () async {
    final calls = <String>[];
    final api = ApiClient(
      baseUrl: 'http://x/api/v1',
      store: MemorySessionStore(),
      client: MockClient((req) async {
        calls.add('${req.method} ${req.url.path} ${req.headers['authorization'] ?? ''}');
        if (req.url.path.endsWith('/auth/login')) return json(loginBody());
        if (req.url.path.endsWith('/auth/refresh')) {
          expect(jsonDecode(req.body), {'refreshToken': 'r1'});
          return json({'tokens': {'accessToken': 'a2', 'refreshToken': 'r2'}});
        }
        return req.headers['authorization'] == 'Bearer a2' ? json({'ok': true}) : json({'error': {'code': 'UNAUTHENTICATED', 'message': 'x'}}, 401);
      }),
    );
    await api.login('b@x.test', 'pw', requiredRole: 'PASSENGER');
    expect(await api.get('/wallet'), {'ok': true});
    expect(calls.where((c) => c.contains('/auth/refresh')).length, 1);
    expect(api.session?.refreshToken, 'r2');
  });

  test('a failed refresh clears the session and signals logout', () async {
    final api = ApiClient(
      baseUrl: 'http://x/api/v1',
      store: MemorySessionStore(),
      client: MockClient((req) async => req.url.path.endsWith('/auth/login') ? json(loginBody()) : json({'error': {'code': 'UNAUTHENTICATED', 'message': 'x'}}, 401)),
    );
    await api.login('b@x.test', 'pw', requiredRole: 'PASSENGER');
    var loggedOut = false;
    api.onLoggedOut.listen((_) => loggedOut = true);
    await expectLater(api.get('/wallet'), throwsA(isA<ApiException>()));
    await Future<void>.delayed(Duration.zero);
    expect(api.session, isNull);
    expect(loggedOut, isTrue);
  });

  test('idempotency key is sent as a header and keys are unique', () async {
    String? seen;
    final api = ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore(), client: MockClient((req) async { seen = req.headers['idempotency-key']; return json({'id': 1}); }));
    await api.post('/rides', body: {'a': 1}, idempotencyKey: 'abc');
    expect(seen, 'abc');
    expect(ApiClient.newIdempotencyKey(), isNot(ApiClient.newIdempotencyKey()));
  });

  test('network failures map to a friendly message, server errors never leak raw text', () async {
    final api = ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore(), client: MockClient((_) async => throw http.ClientException('boom')));
    await expectLater(api.get('/x'), throwsA(isA<ApiException>().having((e) => e.friendly, 'friendly', contains('No connection'))));
    final e500 = ApiException(500, 'INTERNAL', 'stack trace here');
    expect(e500.friendly, isNot(contains('stack')));
  });

  test('phone code sign-in sends the code request and stores the session', () async {
    final seen = <String>[];
    final api = ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore(), client: MockClient((req) async {
      seen.add('${req.url.path} ${req.body}');
      if (req.url.path.endsWith('/otp/request')) return json({'sent': true, 'devCode': '123456'});
      return json(loginBody());
    }));
    final r = await api.requestOtp('+923001112233');
    expect(r['devCode'], '123456');
    final s = await api.verifyOtp('+923001112233', '123456', fullName: 'Bilal', requiredRole: 'PASSENGER');
    expect(s.accessToken, 'a1');
    expect(seen.last, contains('"fullName":"Bilal"'));
    await expectLater(api.verifyOtp('+923001112233', '123456', requiredRole: 'DRIVER'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'WRONG_APP')));
  });

  test('formatting helpers', () {
    expect(money(2865), 'Rs 2,865');
    expect(money(null), '–');
    expect(prettyStatus('DRIVER_ARRIVING'), 'Driver arriving');
    expect(km(12888), '12.9 km');
  });
}

void serverUrlTests() {
  test('setServer normalises addresses and remembers them', () async {
    final store = MemorySessionStore();
    final api = ApiClient(baseUrl: 'http://10.0.2.2:3000/api/v1', store: store);
    await api.setServer('192.168.1.20');
    expect(api.baseUrl, 'http://192.168.1.20:3000/api/v1');
    await api.setServer('http://pc.local:4000/');
    expect(api.baseUrl, 'http://pc.local:4000/api/v1');
    final other = ApiClient(baseUrl: 'http://10.0.2.2:3000/api/v1', store: store);
    await other.restore();
    expect(other.baseUrl, 'http://pc.local:4000/api/v1');
    expect(() => api.setServer('  '), throwsArgumentError);
  });
}

void referralTest() {
  test('sign-up sends the referral code only when one was entered', () async {
    final bodies = <Map<String, dynamic>>[];
    final api = ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore(), client: MockClient((req) async { bodies.add(jsonDecode(req.body) as Map<String, dynamic>); return json(loginBody()); }));
    await api.register(fullName: 'Ayesha', email: 'a@x.test', password: 'Passw0rd!x', role: 'PASSENGER', referralCode: 'TBILAL01');
    await api.register(fullName: 'Ayesha', email: 'a@x.test', password: 'Passw0rd!x', role: 'PASSENGER', referralCode: '');
    expect(bodies[0]['referralCode'], 'TBILAL01');
    expect(bodies[1].containsKey('referralCode'), isFalse);
  });
}

void retryTests() {
  test('reads and keyed writes are retried after a network failure; plain writes are not', () async {
    var gets = 0;
    var posts = 0;
    final api = ApiClient(
      baseUrl: 'http://x/api/v1',
      store: MemorySessionStore(),
      retryDelays: const [Duration.zero, Duration.zero],
      client: MockClient((req) async {
        if (req.method == 'GET') { if (++gets < 3) throw Exception('offline'); return json({'ok': true}); }
        posts++;
        throw Exception('offline');
      }),
    );
    expect((await api.get('/me'))['ok'], true);
    expect(gets, 3);
    await expectLater(api.post('/rides', body: {}), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NETWORK')));
    expect(posts, 1); // no key, so a retry could double-book
    await expectLater(api.post('/rides', body: {}, idempotencyKey: 'k-1'), throwsA(isA<ApiException>()));
    expect(posts, 4); // 1 + (1 try + 2 retries)
  });

  test('503 is retried and then surfaces if it persists', () async {
    var n = 0;
    final api = ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore(), retryDelays: const [Duration.zero], client: MockClient((_) async { n++; return json({'error': {'code': 'X', 'message': 'down'}}, 503); }));
    await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 503)));
    expect(n, 2);
  });
}
