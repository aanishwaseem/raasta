import 'dart:convert';

import 'package:flutter/material.dart';
import '../../util/clipboard.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/banner.dart';
import '../../widgets/load_view.dart';
import '../../widgets/sheets.dart';

class _PrivacyData {
  _PrivacyData(this.profile, this.consents);
  final Json profile;
  final Map<String, bool> consents;
}

const _consentCopy = {
  'LOCATION': ('Location', 'Use your location to find nearby drivers and set your pickup.'),
  'PERSONALIZATION': ('Personalization', 'Learn your usual trips from your own rides to suggest them. You always choose whether to book.'),
  'MARKETING': ('Offers and news', 'Receive promotions and product updates.'),
  'RECURRING_AUTO_DISPATCH': ('Automatic recurring rides', 'Allow commutes you set up to be requested for you without a reminder.'),
  'TERMS': ('Terms of service', 'You accepted these when you signed up.'),
};

/// Personalization controls (view, disable, delete), consents, and personal data export.
class PrivacyScreen extends StatefulWidget {
  const PrivacyScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends State<PrivacyScreen> {
  final _view = GlobalKey<LoadViewState<_PrivacyData>>();
  bool _exporting = false;

  Future<_PrivacyData> _load() async {
    final p = asJson(await widget.api.get('/me/personalization'));
    final c = asJsonList(await widget.api.get('/me/consents'));
    return _PrivacyData(p, {for (final x in c) '${x['kind']}': x['granted'] == true});
  }

  Future<void> _togglePersonalization(bool v) async {
    try {
      await widget.api.patch('/me/personalization', body: {'enabled': v});
      await _view.currentState?.reload();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  Future<void> _consent(String kind, bool v) async {
    try {
      await widget.api.post('/me/consents', body: {'kind': kind, 'granted': v});
      await _view.currentState?.reload();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  Future<void> _deleteProfile() async {
    if (!await confirmDialog(context, title: 'Delete learned data?', message: 'We will erase the usual trips and fare patterns learned from your rides and turn personalization off. Your ride history is kept.', confirm: 'Delete', destructive: true)) return;
    try {
      await widget.api.delete('/me/personalization');
      await _view.currentState?.reload();
      if (mounted) toast(context, 'Personalization data deleted.');
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  Future<void> _export() async {
    setState(() => _exporting = true);
    try {
      final data = asJson(await widget.api.get('/me/export'));
      if (!mounted) return;
      int n(String k) => data[k] is List ? (data[k] as List).length : 0;
      await showAppSheet<void>(context, (c) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const SheetTitle('Your data export', subtitle: 'A copy of what Raasta holds about you.'),
            Text('${n('rides')} rides · ${n('payments')} payments · ${n('savedPlaces')} saved places · ${n('emergencyContacts')} contacts · ${n('ratingsGiven')} ratings'),
            const SizedBox(height: 4),
            Text('Exported ${whenText(data['exportedAt'])}', style: Theme.of(c).textTheme.bodySmall),
            const SizedBox(height: 16),
            FilledButton.icon(onPressed: () { copyText(const JsonEncoder.withIndent('  ').convert(data)); if (c.mounted) Navigator.pop(c); if (mounted) { toast(context, 'Export copied as JSON. Paste it into a note or file to keep it.'); } }, icon: const Icon(Icons.copy_all_outlined), label: const Text('Copy as JSON')),
          ]));
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy and personalization')),
      body: LoadView<_PrivacyData>(key: _view, load: _load, builder: _body),
    );
  }

  List<Widget> _body(BuildContext context, _PrivacyData d, Future<void> Function() reload) {
    final t = Theme.of(context);
    final p = d.profile;
    final enabled = p['personalizationEnabled'] == true;
    final routines = asJsonList(p['routines']);
    final range = asJson(p['typicalFareRange']);
    return [
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SwitchRow(title: 'Smart suggestions', subtitle: '${p['explanation'] ?? 'Suggestions are built from your own completed rides.'}', value: enabled, onChanged: _togglePersonalization),
        if (enabled) ...[
          const Divider(),
          Text('What we learned', style: t.textTheme.titleSmall),
          const SizedBox(height: 4),
          Text('Based on ${p['ridesConsidered'] ?? 0} recent rides${p['preferredProduct'] != null ? ' · you usually ride ${humanize('${p['preferredProduct']}')}' : ''}${range.isNotEmpty ? ' · typical fare ${money(range['low'] as num?)} to ${money(range['high'] as num?)}' : ''}.'),
          if (routines.isEmpty) const Padding(padding: EdgeInsets.only(top: 8), child: Text('No usual trips yet. A routine needs at least 3 similar trips on 2 different days.')),
          for (final r in routines)
            Padding(padding: const EdgeInsets.only(top: 8), child: Row(children: [const Icon(Icons.repeat, size: 18), const SizedBox(width: 8), Expanded(child: Text('${shortAddress(asJson(r['pickup'])['address'], parts: 1)} → ${shortAddress(asJson(r['dropoff'])['address'], parts: 1)} · ${r['occurrences']} trips around ${two(((r['typicalMinutes'] as num?) ?? 0) ~/ 60)}:${two(((r['typicalMinutes'] as num?)?.toInt() ?? 0) % 60)}'))])),
        ],
        const SizedBox(height: 8),
        OutlinedButton.icon(onPressed: _deleteProfile, icon: const Icon(Icons.delete_sweep_outlined), label: const Text('Delete learned data')),
      ]))),
      const SectionTitle('Consents'),
      const InlineBanner('Change your mind any time. Turning something off takes effect immediately.', icon: Icons.info_outline, tone: raastaTeal),
      for (final e in _consentCopy.entries)
        SwitchRow(title: e.value.$1, subtitle: e.value.$2, value: d.consents[e.key] ?? (e.key == 'PERSONALIZATION' ? enabled : false), onChanged: e.key == 'TERMS' ? null : (v) => _consent(e.key, v)),
      const SectionTitle('Your data'),
      InfoTile(icon: Icons.download_outlined, title: 'Export my data', subtitle: _exporting ? 'Preparing…' : 'Profile, rides, payments, places and consents', onTap: _exporting ? null : _export),
    ];
  }
}
