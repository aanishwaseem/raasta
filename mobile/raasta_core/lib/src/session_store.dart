import 'dart:convert';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
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
/// On Android/iOS the tokens live in the platform keystore (Keychain / EncryptedSharedPreferences), not in plain
/// SharedPreferences. Flutter web has no keystore, so there it falls back to SharedPreferences (browser storage) which
/// is why the web builds are demo-only. Non-secret settings (server address, device id) stay in SharedPreferences.
class PrefsSessionStore implements SessionStore {
  PrefsSessionStore({FlutterSecureStorage? secure}) : _secure = secure ?? const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));
  static const _k = 'raasta.session';
  final FlutterSecureStorage _secure;

  Session? _decode(List<String>? v) {
    if (v == null || v.length < 4) return null;
    return Session(accessToken: v[0], refreshToken: v[1], name: v[2], roles: v[3].isEmpty ? [] : v[3].split(','));
  }

  @override
  Future<Session?> read() async {
    final p = await SharedPreferences.getInstance();
    if (kIsWeb) return _decode(p.getStringList(_k));
    try {
      final raw = await _secure.read(key: _k);
      if (raw != null) return _decode((jsonDecode(raw) as List).cast<String>());
    } catch (_) {
      // unreadable keystore entry (e.g. restored backup on a new device): treat as signed out
    }
    // one-time migration of a session saved by an older build in plain SharedPreferences
    final legacy = _decode(p.getStringList(_k));
    if (legacy != null) {
      await write(legacy);
      await p.remove(_k);
    }
    return legacy;
  }

  @override
  Future<void> write(Session? s) async {
    final p = await SharedPreferences.getInstance();
    if (kIsWeb) {
      s == null ? await p.remove(_k) : await p.setStringList(_k, [s.accessToken, s.refreshToken, s.name, s.roles.join(',')]);
      return;
    }
    await p.remove(_k);
    try {
      if (s == null) {
        await _secure.delete(key: _k);
      } else {
        await _secure.write(key: _k, value: jsonEncode([s.accessToken, s.refreshToken, s.name, s.roles.join(',')]));
      }
    } catch (_) {
      // never fall back to storing tokens in the clear; the user simply has to sign in again next launch
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
