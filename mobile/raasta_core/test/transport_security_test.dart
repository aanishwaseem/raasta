import 'package:flutter_test/flutter_test.dart';
import 'package:raasta_core/raasta_core.dart';

void main() {
  group('transport security', () {
    test('release builds accept https only', () {
      expect(isSecureTransportAllowed('https://api.raasta.pk/api/v1', release: true, allowInsecure: false), isTrue);
      expect(isSecureTransportAllowed('http://api.raasta.pk/api/v1', release: true, allowInsecure: false), isFalse);
      expect(isSecureTransportAllowed('http://10.0.2.2:3000/api/v1', release: true, allowInsecure: false), isFalse);
      expect(isSecureTransportAllowed('ftp://x/y', release: true, allowInsecure: false), isFalse);
      expect(isSecureTransportAllowed('not a url', release: true, allowInsecure: false), isFalse);
    });
    test('the explicit demo flag or a debug build permits http', () {
      expect(isSecureTransportAllowed('http://192.168.1.20:3000/api/v1', release: true, allowInsecure: true), isTrue);
      expect(isSecureTransportAllowed('http://10.0.2.2:3000/api/v1', release: false, allowInsecure: false), isTrue);
    });
    test('assertTransportAllowed throws a clear error', () {
      expect(() => assertTransportAllowed('http://x/api', release: true, allowInsecure: false), throwsA(isA<StateError>()));
      expect(() => assertTransportAllowed('https://x/api', release: true, allowInsecure: false), returnsNormally);
    });
    test('the default debug/test mode is unchanged: http base URLs still construct', () {
      expect(() => ApiClient(baseUrl: 'http://x/api/v1', store: MemorySessionStore()), returnsNormally);
    });
  });
}
