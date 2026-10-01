import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:raasta_core/raasta_core.dart';

/// DELETE /me needs a JSON body ({"confirm":"DELETE"}), which the shared client's delete() cannot send,
/// so this one request goes out directly. A cheap authenticated call first makes sure the token is fresh.
Future<void> deleteMyAccount(ApiClient api, {http.Client? client}) async {
  await api.get('/me');
  final token = api.session?.accessToken;
  final c = client ?? http.Client();
  final http.Response res;
  try {
    final req = http.Request('DELETE', Uri.parse('${api.baseUrl}/me'))
      ..headers['content-type'] = 'application/json'
      ..headers['accept'] = 'application/json'
      ..headers['authorization'] = 'Bearer ${token ?? ''}'
      ..body = jsonEncode({'confirm': 'DELETE'});
    res = await http.Response.fromStream(await c.send(req).timeout(const Duration(seconds: 20)));
  } on Exception {
    throw ApiException(0, 'NETWORK', 'No connection');
  }
  if (res.statusCode >= 200 && res.statusCode < 300) return;
  var msg = 'Your account could not be deleted. Please try again or contact support.';
  var code = 'ERROR';
  try {
    final j = jsonDecode(res.body);
    final err = j is Map ? j['error'] : null;
    if (err is Map) {
      code = (err['code'] ?? code).toString();
      if (res.statusCode < 500 && err['message'] is String) msg = err['message'] as String;
    }
  } catch (_) {/* keep generic message */}
  throw ApiException(res.statusCode, code, msg);
}
