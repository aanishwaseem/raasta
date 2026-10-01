import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'session_store.dart';

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;

  /// Copy that is safe to show to people. Raw server text is only used for validation errors.
  String get friendly {
    switch (code) {
      case 'UNAUTHENTICATED':
        return 'Please sign in again.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'NETWORK':
        return 'No connection. Check your internet and try again.';
    }
    return status >= 500 ? 'Something went wrong on our side. Please try again.' : message;
  }

  @override
  String toString() => 'ApiException($status $code: $message)';
}

/// HTTP client for the Raasta API: bearer auth, single-flight token refresh on 401,
/// and Idempotency-Key support for mutating requests that must not be applied twice.
class ApiClient {
  ApiClient({required this.baseUrl, SessionStore? store, http.Client? client})
      : store = store ?? PrefsSessionStore(),
        _http = client ?? http.Client();

  final String baseUrl;
  final SessionStore store;
  final http.Client _http;
  Session? _session;
  Future<bool>? _refreshing;
  final _logout = StreamController<void>.broadcast();

  Session? get session => _session;
  Stream<void> get onLoggedOut => _logout.stream;

  Future<Session?> restore() async => _session = await store.read();

  Future<Session> login(String identifier, String password, {required String requiredRole}) async {
    final res = await _send('POST', '/auth/login', body: {
      'identifier': identifier,
      'password': password,
      'device': {'deviceId': await store.deviceId(), 'platform': 'android'},
    }, auth: false);
    final roles = List<String>.from(res['user']['roles'] as List);
    if (!roles.contains(requiredRole)) {
      throw ApiException(403, 'WRONG_APP', 'This account is not registered as a ${requiredRole.toLowerCase()}.');
    }
    final t = res['tokens'] as Map<String, dynamic>;
    final s = Session(accessToken: t['accessToken'], refreshToken: t['refreshToken'], name: (res['user']['fullName'] ?? identifier) as String, roles: roles);
    await store.write(_session = s);
    return s;
  }

  /// Sends a login code by SMS. In development the API can echo the code as `devCode`.
  Future<Map<String, dynamic>> requestOtp(String phone) async => Map<String, dynamic>.from(await _send('POST', '/auth/otp/request', body: {'phone': phone}, auth: false) as Map);

  Future<Session> verifyOtp(String phone, String code, {String? fullName, required String requiredRole}) async {
    final res = await _send('POST', '/auth/otp/verify', body: {
      'phone': phone,
      'code': code,
      if (fullName != null && fullName.isNotEmpty) 'fullName': fullName,
      'role': requiredRole,
      'device': {'deviceId': await store.deviceId(), 'platform': 'android'},
    }, auth: false);
    final roles = List<String>.from(res['user']['roles'] as List);
    if (!roles.contains(requiredRole)) throw ApiException(403, 'WRONG_APP', 'This account is not registered as a ${requiredRole.toLowerCase()}.');
    final t = res['tokens'] as Map<String, dynamic>;
    final s = Session(accessToken: t['accessToken'], refreshToken: t['refreshToken'], name: (res['user']['fullName'] ?? phone) as String, roles: roles);
    await store.write(_session = s);
    return s;
  }

  Future<Session> register({required String fullName, String? email, String? phone, required String password, required String role}) async {
    final res = await _send('POST', '/auth/register', body: {
      'fullName': fullName,
      if (email != null && email.isNotEmpty) 'email': email,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      'password': password,
      'role': role,
      'device': {'deviceId': await store.deviceId(), 'platform': 'android'},
    }, auth: false);
    final t = res['tokens'] as Map<String, dynamic>;
    final s = Session(accessToken: t['accessToken'], refreshToken: t['refreshToken'], name: fullName, roles: List<String>.from(res['user']['roles'] as List));
    await store.write(_session = s);
    return s;
  }

  Future<void> logout() async {
    try {
      if (_session != null) await _send('POST', '/auth/logout', expectBody: false);
    } catch (_) {/* best effort */}
    await store.write(_session = null);
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) => _authed('GET', path, query: query);
  Future<dynamic> post(String path, {Object? body, String? idempotencyKey}) => _authed('POST', path, body: body, idempotencyKey: idempotencyKey);
  /// Multipart upload (driver documents). [fields] are form fields, [bytes] the file content.
  Future<dynamic> upload(String path, {required Map<String, String> fields, required List<int> bytes, required String filename}) async {
    Future<dynamic> once() async {
      final req = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'))
        ..fields.addAll(fields)
        ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));
      if (_session != null) req.headers['authorization'] = 'Bearer ${_session!.accessToken}';
      final http.Response res;
      try {
        res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 60)));
      } on Exception {
        throw ApiException(0, 'NETWORK', 'No connection');
      }
      final dynamic json = res.body.isEmpty ? null : jsonDecode(res.body);
      if (res.statusCode >= 200 && res.statusCode < 300) return json;
      final err = (json is Map ? json['error'] : null) as Map?;
      final msg = err?['message'];
      throw ApiException(res.statusCode, (err?['code'] ?? 'ERROR') as String, msg is List ? msg.join(', ') : (msg ?? 'Upload failed').toString());
    }

    try {
      return await once();
    } on ApiException catch (e) {
      if (e.status != 401 || _session == null || !await _refresh()) rethrow;
      return once();
    }
  }

  Future<dynamic> patch(String path, {Object? body}) => _authed('PATCH', path, body: body);
  Future<dynamic> delete(String path) => _authed('DELETE', path);

  Future<dynamic> _authed(String method, String path, {Map<String, String>? query, Object? body, String? idempotencyKey}) async {
    try {
      return await _send(method, path, query: query, body: body, idempotencyKey: idempotencyKey);
    } on ApiException catch (e) {
      if (e.status != 401 || _session == null) rethrow;
      if (!await _refresh()) {
        await store.write(_session = null);
        _logout.add(null);
        rethrow;
      }
      return _send(method, path, query: query, body: body, idempotencyKey: idempotencyKey);
    }
  }

  Future<bool> _refresh() {
    return _refreshing ??= () async {
      try {
        final s = _session!;
        final res = await _send('POST', '/auth/refresh', body: {'refreshToken': s.refreshToken}, auth: false);
        final t = res['tokens'] as Map<String, dynamic>;
        await store.write(_session = s.copyWith(accessToken: t['accessToken'], refreshToken: t['refreshToken']));
        return true;
      } on ApiException {
        return false;
      } finally {
        _refreshing = null;
      }
    }();
  }

  Future<dynamic> _send(String method, String path, {Map<String, String>? query, Object? body, bool auth = true, String? idempotencyKey, bool expectBody = true}) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final req = http.Request(method, uri)
      ..headers['content-type'] = 'application/json'
      ..headers['accept'] = 'application/json';
    if (auth && _session != null) req.headers['authorization'] = 'Bearer ${_session!.accessToken}';
    if (idempotencyKey != null) req.headers['idempotency-key'] = idempotencyKey;
    if (body != null) req.body = jsonEncode(body);
    final http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 20)));
    } on Exception {
      throw ApiException(0, 'NETWORK', 'No connection');
    }
    final text = res.body;
    final dynamic json = text.isEmpty ? null : jsonDecode(text);
    if (res.statusCode >= 200 && res.statusCode < 300) return json;
    final err = (json is Map ? json['error'] : null) as Map?;
    final msg = err?['message'];
    throw ApiException(res.statusCode, (err?['code'] ?? 'ERROR') as String, msg is List ? msg.join(', ') : (msg ?? res.reasonPhrase ?? 'Request failed').toString());
  }

  /// One key per user intent. Reuse the same key when retrying the same tap.
  static String newIdempotencyKey() => 'k-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-${_n++}';
  static int _n = 0;
}
