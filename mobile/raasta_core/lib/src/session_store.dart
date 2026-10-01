import 'package:shared_preferences/shared_preferences.dart';

class Session {
  const Session({required this.accessToken, required this.refreshToken, required this.name, required this.roles});
  final String accessToken;
  final String refreshToken;
  final String name;
  final List<String> roles;

  Session copyWith({String? accessToken, String? refreshToken}) => Session(
        accessToken: accessToken ?? this.accessToken,
        refreshToken: refreshToken ?? this.refreshToken,
        name: name,
        roles: roles,
      );
}

abstract class SessionStore {
  Future<Session?> read();
  Future<void> write(Session? session);
  Future<String> deviceId();
  Future<String?> serverUrl();
  Future<void> writeServerUrl(String? url);
}

/// Persists the session on the device. Tokens never leave this store except in Authorization headers.
class PrefsSessionStore implements SessionStore {
  static const _k = 'raasta.session';

  @override
  Future<Session?> read() async {
    final p = await SharedPreferences.getInstance();
    final v = p.getStringList(_k);
    if (v == null || v.length < 4) return null;
    return Session(accessToken: v[0], refreshToken: v[1], name: v[2], roles: v[3].isEmpty ? [] : v[3].split(','));
  }

  @override
  Future<void> write(Session? s) async {
    final p = await SharedPreferences.getInstance();
    if (s == null) {
      await p.remove(_k);
    } else {
      await p.setStringList(_k, [s.accessToken, s.refreshToken, s.name, s.roles.join(',')]);
    }
  }

  @override
  Future<String?> serverUrl() async => (await SharedPreferences.getInstance()).getString('raasta.server');

  @override
  Future<void> writeServerUrl(String? url) async {
    final p = await SharedPreferences.getInstance();
    url == null ? await p.remove('raasta.server') : await p.setString('raasta.server', url);
  }

  @override
  Future<String> deviceId() async {
    final p = await SharedPreferences.getInstance();
    var id = p.getString('raasta.device');
    if (id == null) {
      id = 'dev-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
      await p.setString('raasta.device', id);
    }
    return id;
  }
}

class MemorySessionStore implements SessionStore {
  Session? _s;
  @override
  Future<Session?> read() async => _s;
  @override
  Future<void> write(Session? session) async => _s = session;
  @override
  Future<String> deviceId() async => 'test-device-1';
  String? _server;
  @override
  Future<String?> serverUrl() async => _server;
  @override
  Future<void> writeServerUrl(String? url) async => _server = url;
}
