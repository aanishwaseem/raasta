import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/json.dart';
import 'sheets.dart';

/// Confirms, then sends an SOS for a ride with the device location when available.
Future<void> confirmAndSendSos(BuildContext context, ApiClient api, String rideId, {DeviceLocation? location}) async {
  final ok = await confirmDialog(
    context,
    title: 'Send an SOS alert?',
    message: 'Raasta safety staff and your trusted contacts will be alerted with your live trip link. In immediate danger, call 15 (Police) first.',
    confirm: 'Send SOS',
    destructive: true,
  );
  if (!ok || !context.mounted) return;
  final f = await (location ?? DeviceLocation()).current();
  try {
    final r = asJson(await api.post('/rides/$rideId/sos', body: f.approximate ? {} : {'location': {'lat': f.lat, 'lng': f.lng}}));
    if (!context.mounted) return;
    final n = (r['contactsNotified'] as num?)?.toInt() ?? 0;
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        icon: Icon(Icons.sos, color: Theme.of(c).colorScheme.error, size: 36),
        title: const Text('SOS sent'),
        content: Text('Our safety team has been alerted${n > 0 ? ' and $n trusted contact${n == 1 ? '' : 's'} notified' : ''}. If you are in danger, call ${r['emergencyNumber'] ?? '15'} now from your phone.'),
        actions: [FilledButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))],
      ),
    );
  } on ApiException catch (e) {
    if (context.mounted) toast(context, 'SOS could not be sent: ${e.friendly} Call 15 if you are in danger.');
  }
}
