import 'package:flutter/material.dart';
import '../../util/clipboard.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../widgets/sheets.dart';
import '../../widgets/sos.dart';

/// Shown when the server flags a route deviation or a trip ending away from the destination.
/// Every button does a real thing: confirm safe, get the driver's number, share the trip, or raise SOS.
Future<void> showSafetyPrompt(BuildContext context, ApiClient api, Json alert, {DeviceLocation? location}) {
  return showAppSheet<void>(context, (c) => _SafetyPrompt(api: api, alert: alert, location: location));
}

class _SafetyPrompt extends StatefulWidget {
  const _SafetyPrompt({required this.api, required this.alert, this.location});
  final ApiClient api;
  final Json alert;
  final DeviceLocation? location;
  @override
  State<_SafetyPrompt> createState() => _SafetyPromptState();
}

class _SafetyPromptState extends State<_SafetyPrompt> {
  bool _busy = false;
  String? _info;
  String? _error;

  Future<Json?> _respond(String r) async {
    setState(() { _busy = true; _error = null; });
    try {
      return asJson(await widget.api.post('/safety/events/${widget.alert['eventId']}/respond', body: {'response': r}));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _safe() async {
    if (await _respond('SAFE') != null && mounted) {
      Navigator.pop(context);
      toast(context, 'Thanks for letting us know. Glad you are safe.');
    }
  }

  Future<void> _contactDriver() async {
    final r = await _respond('CONTACT_DRIVER');
    if (r == null || !mounted) return;
    final phone = r['driverPhone']?.toString();
    if (phone != null && phone.isNotEmpty) copyText(phone);
    setState(() => _info = phone == null || phone.isEmpty ? 'Driver number is not available. You can use SOS if you feel unsafe.' : 'Driver number $phone copied. Paste it into your phone dialer to call.');
  }

  Future<void> _share() async {
    final r = await _respond('SHARE');
    if (r == null || !mounted) return;
    final url = r['url']?.toString();
    if (url != null) copyText(url);
    setState(() => _info = 'Live trip link copied${(r['recipients'] ?? 0) is num && (r['recipients'] as num) > 0 ? ' and sent to your contacts' : ''}.');
  }

  Future<void> _sos() async {
    final rideId = widget.alert['rideId']?.toString();
    if (rideId == null) return;
    Navigator.pop(context);
    await confirmAndSendSos(context, widget.api, rideId, location: widget.location);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final offered = widget.alert['actions'] is List ? (widget.alert['actions'] as List).map((a) => a is Map ? a['code'] : null).toSet() : null;
    bool offers(String code) => offered == null || offered.contains(code);
    final severe = widget.alert['severity'] == 'HIGH' || widget.alert['severity'] == 'CRITICAL';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Icon(Icons.shield_outlined, color: severe ? t.colorScheme.error : const Color(0xFF9A6200), size: 32),
        const SizedBox(width: 12),
        Expanded(child: Text('Are you safe?', style: t.textTheme.titleLarge)),
      ]),
      const SizedBox(height: 12),
      Text('${widget.alert['message'] ?? 'We noticed something unusual on your trip.'}', style: t.textTheme.titleSmall),
      if (widget.alert['detail'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${widget.alert['detail']}', style: t.textTheme.bodyMedium)),
      if (_info != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_info!, style: TextStyle(color: Colors.green.shade700, fontWeight: FontWeight.w600))),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: t.colorScheme.error))),
      const SizedBox(height: 16),
      FilledButton.icon(onPressed: _busy ? null : _safe, icon: const Icon(Icons.check_circle_outline), label: const Text("I'm safe")),
      const SizedBox(height: 8),
      if (offers('CONTACT_DRIVER') || offers('SHARE')) ...[
        Row(children: [
          if (offers('CONTACT_DRIVER')) Expanded(child: OutlinedButton(onPressed: _busy ? null : _contactDriver, child: const Text('Contact driver'))),
          if (offers('CONTACT_DRIVER') && offers('SHARE')) const SizedBox(width: 8),
          if (offers('SHARE')) Expanded(child: OutlinedButton(onPressed: _busy ? null : _share, child: const Text('Share ride'))),
        ]),
        const SizedBox(height: 8),
      ],
      FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: t.colorScheme.error), onPressed: _busy ? null : _sos, icon: const Icon(Icons.sos), label: const Text('SOS')),
    ]);
  }
}
