import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:raasta_core/raasta_core.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const s = Session(accessToken: 'AT', refreshToken: 'RT', name: 'Bilal', roles: ['PASSENGER']);

  test('tokens go to the secure store and never to SharedPreferences', () async {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    final store = PrefsSessionStore();
    await store.write(s);
    final back = await store.read();
    expect(back!.refreshToken, 'RT');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getKeys().any((k) => (prefs.get(k)).toString().contains('RT')), isFalse);
    await store.write(null);
    expect(await store.read(), isNull);
  });

  test('a session saved in plain SharedPreferences by an older build is migrated and removed', () async {
    SharedPreferences.setMockInitialValues({'raasta.session': ['AT', 'RT', 'Bilal', 'PASSENGER']});
    FlutterSecureStorage.setMockInitialValues({});
    final store = PrefsSessionStore();
    expect((await store.read())!.accessToken, 'AT');
    expect((await SharedPreferences.getInstance()).getStringList('raasta.session'), isNull);
    expect((await store.read())!.accessToken, 'AT');
  });
}
