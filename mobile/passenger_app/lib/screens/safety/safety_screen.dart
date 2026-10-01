import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../widgets/load_view.dart';
import '../../widgets/share_ride_sheet.dart';
import '../../widgets/sheets.dart';
import '../../widgets/sos.dart';
import '../trip/trip_screen.dart';
import 'contact_sheet.dart';
import 'safety_prefs.dart';

class _SafetyData {
  _SafetyData(this.contacts, this.prefs, this.activeRideId);
  final List<Json> contacts;
  final Json prefs;
  final String? activeRideId;
}

/// Safety hub: SOS, live ride sharing, trusted contacts, safety preferences and how Ride PIN works.
class SafetyScreen extends StatefulWidget {
  const SafetyScreen({super.key, required this.api, required this.location});
  final ApiClient api;
  final DeviceLocation location;
  @override
  State<SafetyScreen> createState() => _SafetyScreenState();
}

class _SafetyScreenState extends State<SafetyScreen> {
  final _view = GlobalKey<LoadViewState<_SafetyData>>();

  Future<_SafetyData> _load() async {
    final contacts = asJsonList(await widget.api.get('/me/emergency-contacts'));
    Json prefs = {};
    String? active;
    try { prefs = asJson(asJson(await widget.api.get('/me/preferences'))['safety']); } on ApiException {/* defaults */}
    try { active = asJson(await widget.api.get('/rides/active'))['id'] as String?; } on ApiException {/* none */}
    return _SafetyData(contacts, prefs, active);
  }

  Future<void> _edit([Json? c]) async {
    if (await showContactSheet(context, widget.api, existing: c) == true) _view.currentState?.reload();
  }

  Future<void> _remove(Json c) async {
    if (!await confirmDialog(context, title: 'Remove ${c['name']}?', message: 'They will no longer receive your trip links or SOS alerts.', confirm: 'Remove', destructive: true)) return;
    try {
      await widget.api.delete('/me/emergency-contacts/${c['id']}');
      _view.currentState?.reload();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Safety')),
      body: LoadView<_SafetyData>(key: _view, load: _load, builder: _body),
    );
  }

  List<Widget> _body(BuildContext context, _SafetyData d, Future<void> Function() reload) {
    final t = Theme.of(context);
    final err = t.colorScheme.error;
    return [
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: err.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(20), border: Border.all(color: err.withValues(alpha: 0.4))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Icon(Icons.sos, color: err, size: 28), const SizedBox(width: 10), Expanded(child: Text('In danger? Call 15 (Police) first.', style: t.textTheme.titleMedium))]),
          const SizedBox(height: 8),
          const Text('During a ride, SOS alerts the Raasta safety team and texts your trusted contacts your live trip link.'),
          const SizedBox(height: 12),
          if (d.activeRideId != null) ...[
            Row(children: [
              Expanded(child: OutlinedButton.icon(onPressed: () => showShareRideSheet(context, widget.api, d.activeRideId!), icon: const Icon(Icons.share_outlined), label: const Text('Share trip'))),
              const SizedBox(width: 8),
              Expanded(child: FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: err), onPressed: () => confirmAndSendSos(context, widget.api, d.activeRideId!, location: widget.location), icon: const Icon(Icons.sos), label: const Text('SOS'))),
            ]),
            TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, rideId: d.activeRideId!, location: widget.location))), child: const Text('Open my current ride')),
          ] else
            Text('You have no ride in progress. Share and SOS buttons appear here, and on the ride screen, during a trip.', style: t.textTheme.bodySmall),
        ]),
      ),
      SectionTitle('Trusted contacts', action: 'Add', onAction: _edit),
      if (d.contacts.isEmpty) const EmptyStateInline(),
      for (final c in d.contacts)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: InfoTile(
            icon: Icons.person_outline,
            title: '${c['name']}',
            subtitle: '${c['phone']}${c['relationship'] != null ? ' · ${c['relationship']}' : ''}${c['shareByDefault'] == true ? ' · auto-share' : ''}',
            onTap: () => _edit(c),
            trailing: IconButton(tooltip: 'Remove ${c['name']}', icon: const Icon(Icons.delete_outline), onPressed: () => _remove(c)),
          ),
        ),
      const SectionTitle('Protection preferences'),
      SafetyPrefs(api: widget.api, initial: d.prefs),
      const SectionTitle('How Ride PIN works'),
      InfoTile(icon: Icons.pin_outlined, title: 'A 4-digit PIN for every trip', subtitle: 'You see it once a driver is assigned. Only tell it to your driver after you check the car and plate match. The trip cannot start without it.', trailing: const SizedBox.shrink(), color: raastaAmber),
      const SectionTitle('More ways we protect you'),
      const InfoTile(icon: Icons.alt_route, title: 'Route monitoring', subtitle: 'If your trip leaves the planned route or ends far from your destination, we ask if you are safe.', trailing: SizedBox.shrink()),
      const SizedBox(height: 8),
      const InfoTile(icon: Icons.link, title: 'Live trip link', subtitle: 'Anyone with the link can follow your trip until a few hours after it ends. Share only with people you trust.', trailing: SizedBox.shrink()),
    ];
  }
}

class EmptyStateInline extends StatelessWidget {
  const EmptyStateInline({super.key});
  @override
  Widget build(BuildContext context) => const Padding(padding: EdgeInsets.all(12), child: Text('No trusted contacts yet. Add someone who should know when you ride.'));
}
