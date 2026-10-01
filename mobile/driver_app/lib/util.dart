import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

/// Colours that carry meaning in the driver app. High contrast on the dark theme.
const goGreen = Color(0xFF22C55E);
const sosRed = Color(0xFFEF4444);
const demandHigh = Color(0xFFEF4444);
const demandMedium = Color(0xFFF59E0B);
const demandLow = Color(0xFF38BDF8);

double dbl(dynamic v, [double fallback = 0]) => v is num ? v.toDouble() : double.tryParse('$v') ?? fallback;

Map<String, dynamic> asMap(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

List<Map<String, dynamic>> asList(dynamic v) => v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : <Map<String, dynamic>>[];

/// People-safe message for any failure. Raw exceptions never reach the screen.
String errorText(Object e) => e is ApiException ? e.friendly : 'Something went wrong. Please try again.';

bool isNetworkError(Object e) => e is ApiException && e.code == 'NETWORK';

DateTime? when(dynamic v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

String clock(DateTime t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

String dayLabel(DateTime t) => '${t.day}/${t.month}';

/// Great-circle distance in metres.
double distanceM(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371000.0;
  double rad(double d) => d * math.pi / 180;
  final a = math.pow(math.sin(rad(lat2 - lat1) / 2), 2) + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.pow(math.sin(rad(lng2 - lng1) / 2), 2);
  return 2 * r * math.asin(math.min(1, math.sqrt(a)));
}

Color demandColor(String level) => switch (level) { 'HIGH' => demandHigh, 'MEDIUM' => demandMedium, _ => demandLow };

String demandLabel(String level) => switch (level) { 'HIGH' => 'High', 'MEDIUM' => 'Medium', _ => 'Low' };

/// Status chip colours shared by documents, vehicles and onboarding steps.
({String label, Color color, IconData icon}) statusStyle(String s) => switch (s) {
      'APPROVED' || 'DONE' || 'OK' || 'VERIFIED' => (label: 'Approved', color: goGreen, icon: Icons.check_circle),
      'PENDING' || 'PENDING_REVIEW' => (label: 'Pending', color: raastaAmber, icon: Icons.hourglass_top),
      'REJECTED' => (label: 'Rejected', color: sosRed, icon: Icons.cancel),
      'EXPIRED' => (label: 'Expired', color: sosRed, icon: Icons.event_busy),
      _ => (label: 'Not added', color: const Color(0xFF94A3B8), icon: Icons.radio_button_unchecked),
    };

/// A pill chip for a document / vehicle / step status.
Widget statusChip(String s) {
  final st = statusStyle(s);
  return StatusPill(st.label, color: st.color);
}
