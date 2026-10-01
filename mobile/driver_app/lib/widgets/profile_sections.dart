import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

const docLabels = {
  'CNIC_FRONT': 'CNIC (front)',
  'CNIC_BACK': 'CNIC (back)',
  'DRIVING_LICENSE': 'Driving licence',
  'PROFILE_PHOTO': 'Profile photo',
  'VEHICLE_REGISTRATION': 'Vehicle registration',
  'VEHICLE_PHOTO': 'Vehicle photo',
  'INSURANCE': 'Insurance',
  'ROUTE_PERMIT': 'Route permit',
};

/// Badges are derived only from facts the API returns about this driver.
List<String> earnedBadges(Map<String, dynamic> me, List<Map<String, dynamic>> docs) => [
      if (me['status'] == 'APPROVED' && !docs.any((d) => d['status'] == 'EXPIRED')) 'Verified Driver',
    ];

class ProfileHeader extends StatelessWidget {
  const ProfileHeader({super.key, required this.me, required this.badges});
  final Map<String, dynamic> me;
  final List<String> badges;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final name = '${me['fullName'] ?? 'Driver'}';
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        CircleAvatar(radius: 32, backgroundColor: t.colorScheme.primary, child: Text(name.isEmpty ? 'D' : name[0].toUpperCase(), style: t.textTheme.headlineMedium?.copyWith(color: Colors.black))),
        const SizedBox(width: 16),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(name, style: t.textTheme.titleLarge),
          if (me['phone'] != null) Text('${me['phone']}', style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.onSurfaceVariant)),
          if (me['cnicLast4'] != null) Text('CNIC ending ${me['cnicLast4']}', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant)),
        ])),
        statusChip('${me['status']}' == 'PENDING_REVIEW' ? 'PENDING' : '${me['status']}'),
      ]),
      const SizedBox(height: 12),
      if (badges.isEmpty)
        Text('Badges such as Verified Driver appear when your profile and documents qualify.', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant))
      else
        Wrap(spacing: 8, children: [for (final b in badges) Chip(avatar: const Icon(Icons.verified, color: goGreen, size: 18), label: Text(b))]),
    ])));
  }
}

class VehicleSection extends StatelessWidget {
  const VehicleSection({super.key, required this.vehicles});
  final List<Map<String, dynamic>> vehicles;
  @override
  Widget build(BuildContext context) {
    if (vehicles.isEmpty) return const InfoTile(icon: Icons.directions_car, title: 'No vehicle added', subtitle: 'Add your vehicle during onboarding.');
    return Column(children: [
      for (final v in vehicles)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(
          icon: Icons.directions_car,
          title: '${v['make']} ${v['model']} ${v['year'] ?? ''}'.trim(),
          subtitle: '${v['plateNumber']} · ${v['color']} · ${prettyStatus('${v['vehicleClass']}')}${v['current'] == true ? ' · In use' : ''}',
          trailing: statusChip('${v['status']}'),
        )),
    ]);
  }
}

class DocumentsSection extends StatelessWidget {
  const DocumentsSection({super.key, required this.docs});
  final List<Map<String, dynamic>> docs;

  String? _note(Map<String, dynamic> d) {
    final parts = [
      if (d['status'] == 'REJECTED' && d['rejectionReason'] != null) 'Reason: ${d['rejectionReason']}',
      if (when(d['expiresOn']) != null) 'Expires ${when(d['expiresOn'])!.toString().substring(0, 10)}',
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
  @override
  Widget build(BuildContext context) {
    if (docs.isEmpty) return const InfoTile(icon: Icons.description_outlined, title: 'No documents uploaded');
    return Column(children: [
      for (final d in docs)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(
          icon: Icons.description,
          title: docLabels['${d['docType']}'] ?? '${d['docType']}',
          subtitle: _note(d),
          trailing: statusChip('${d['status']}'),
        )),
    ]);
  }
}

/// Ride preferences saved with PATCH /driver/preferences as soon as they change.
class PreferencesSection extends StatefulWidget {
  const PreferencesSection({super.key, required this.api, required this.prefs});
  final ApiClient api;
  final Map<String, dynamic> prefs;
  @override
  State<PreferencesSection> createState() => _PreferencesSectionState();
}

class _PreferencesSectionState extends State<PreferencesSection> {
  late bool _shared = widget.prefs['acceptShared'] != false;
  late bool _intercity = widget.prefs['acceptIntercity'] == true;
  late double _km = dbl(widget.prefs['maxPickupKm'], 5).clamp(1, 10);

  Future<void> _save(Map<String, Object> patch, VoidCallback revert) async {
    try {
      await widget.api.patch('/driver/preferences', body: patch);
    } catch (e) {
      if (mounted) {
        setState(revert);
        toast(context, errorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Card(child: Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Column(children: [
      SwitchListTile(contentPadding: const EdgeInsets.symmetric(horizontal: 16), title: const Text('Accept shared rides'), subtitle: const Text('Pick up more than one rider on one trip'), value: _shared, onChanged: (v) { setState(() => _shared = v); _save({'acceptShared': v}, () => _shared = !v); }),
      SwitchListTile(contentPadding: const EdgeInsets.symmetric(horizontal: 16), title: const Text('Accept intercity requests'), value: _intercity, onChanged: (v) { setState(() => _intercity = v); _save({'acceptIntercity': v}, () => _intercity = !v); }),
      Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), child: Row(children: [Expanded(child: Text('Maximum pickup distance', style: t.textTheme.bodyLarge)), Text('${_km.round()} km', style: t.textTheme.titleMedium)])),
      Slider(value: _km, min: 1, max: 10, divisions: 9, label: '${_km.round()} km', onChanged: (v) => setState(() => _km = v), onChangeEnd: (v) { final old = _km; _save({'maxPickupKm': v.round()}, () => _km = old); }),
    ])));
  }
}
