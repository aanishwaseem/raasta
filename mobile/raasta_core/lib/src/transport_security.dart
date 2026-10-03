import 'package:flutter/foundation.dart';

/// Cleartext (http://) is allowed only in debug/profile builds, or in a release build that was explicitly compiled for
/// the LAN demo with `--dart-define=ALLOW_INSECURE_HTTP=true`. Production builds must talk https:// only.
const bool allowInsecureHttp = bool.fromEnvironment('ALLOW_INSECURE_HTTP', defaultValue: false);

/// True when [url] may be used for API traffic under the current build mode.
bool isSecureTransportAllowed(String url, {bool release = kReleaseMode, bool allowInsecure = allowInsecureHttp}) {
  final u = Uri.tryParse(url.trim());
  if (u == null || u.host.isEmpty) return false;
  if (u.scheme == 'https') return true;
  if (u.scheme != 'http') return false;
  return !release || allowInsecure;
}

/// Throws [StateError] (a programming/configuration error, not a runtime condition) when [url] is not permitted.
void assertTransportAllowed(String url, {bool release = kReleaseMode, bool allowInsecure = allowInsecureHttp}) {
  if (!isSecureTransportAllowed(url, release: release, allowInsecure: allowInsecure)) {
    throw StateError('Refusing to use "$url": release builds require an https:// API_URL '
        '(demo builds only: --dart-define=ALLOW_INSECURE_HTTP=true).');
  }
}
