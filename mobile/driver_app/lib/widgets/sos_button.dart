import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

/// Always-reachable safety button. With a [rideId] it raises an SOS on that trip; without one it shows what to do.
class SosButton extends StatelessWidget {
  const SosButton({super.key, required this.api, required this.location, this.rideId, this.position});
  final ApiClient api;
  final DeviceLocation location;
  final String? rideId;
  final Fix? position;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Safety, SOS',
      child: Material(
        color: sosRed,
        shape: const CircleBorder(),
        elevation: 4,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => _SosSheet(api: api, rideId: rideId, position: position)),
          child: const SizedBox(width: 60, height: 60, child: Center(child: Text('SOS', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16)))),
        ),
      ),
    );
  }
}

class _SosSheet extends StatefulWidget {
  const _SosSheet({required this.api, required this.rideId, required this.position});
  final ApiClient api;
  final String? rideId;
  final Fix? position;
  @override
  State<_SosSheet> createState() => _SosSheetState();
}

class _SosSheetState extends State<_SosSheet> {
  bool _busy = false;
  String? _error;
  Map<String, dynamic>? _done;

  Future<void> _send() async {
    setState(() { _busy = true; _error = null; });
    try {
      final p = widget.position;
      final r = await widget.api.post('/rides/${widget.rideId}/sos', body: p == null || p.approximate ? {} : {'location': {'lat': p.lat, 'lng': p.lng}});
      if (mounted) setState(() => _done = asMap(r));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final inTrip = widget.rideId != null;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [const Icon(Icons.shield, color: sosRed, size: 32), const SizedBox(width: 12), Expanded(child: Text(_done != null ? 'SOS sent' : 'Emergency help', style: t.textTheme.headlineSmall))]),
          const SizedBox(height: 12),
          if (_done != null) ...[
            Text('Raasta\'s safety team has been alerted${_done!['contactsNotified'] is num && (_done!['contactsNotified'] as num) > 0 ? ' and ${_done!['contactsNotified']} trusted contact(s) were notified' : ''}. Stay as safe as you can.', style: t.textTheme.bodyLarge),
            const SizedBox(height: 8),
            Text('In immediate danger, call ${_done!['emergencyNumber'] ?? '15'} (Police) now.', style: t.textTheme.titleMedium?.copyWith(color: sosRed)),
          ] else ...[
            Text(inTrip ? 'This alerts the Raasta safety team and your trusted contacts, and shares your live location from this trip.' : 'SOS alerts are tied to a trip, so start or accept a trip to raise one in the app. If you are in danger now, call 15 (Police).', style: t.textTheme.bodyLarge),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: t.colorScheme.error))),
            const SizedBox(height: 16),
            if (inTrip) FilledButton(onPressed: _busy ? null : _send, style: FilledButton.styleFrom(backgroundColor: sosRed, foregroundColor: Colors.white, minimumSize: const Size.fromHeight(64)), child: _busy ? const CircularProgressIndicator(color: Colors.white) : const Text('Send SOS now')),
            if (!inTrip) FilledButton.icon(onPressed: () { Clipboard.setData(const ClipboardData(text: '15')); toast(context, 'Emergency number 15 copied. Open your phone app to call.'); }, icon: const Icon(Icons.copy), label: const Text('Copy emergency number 15')),
          ],
          const SizedBox(height: 8),
          OutlinedButton(onPressed: () => Navigator.pop(context), child: Text(_done != null ? 'Close' : 'Cancel')),
        ]),
      ),
    );
  }
}
