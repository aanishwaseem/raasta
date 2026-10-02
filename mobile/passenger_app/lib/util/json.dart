import 'package:raasta_core/raasta_core.dart';

typedef Json = Map<String, dynamic>;

Json asJson(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

List<Json> asJsonList(Object? v) => v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : <Json>[];

/// Items of a paged response ({items: [...]}) or a bare list.
List<Json> pageItems(Object? v) => v is Map ? asJsonList(v['items']) : asJsonList(v);

double dbl(Object? v, [double fallback = 0]) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) ?? fallback : fallback);

int? intOrNull(Object? v) => v is num ? v.round() : null;

/// Message that is safe to show to people. Never pass raw exceptions to the UI.
String errText(Object e) => e is ApiException ? e.friendly : 'Something went wrong. Please try again.';

/// True when the failure is a connectivity problem rather than a server answer.
bool isOffline(Object e) => e is ApiException && e.code == 'NETWORK';
