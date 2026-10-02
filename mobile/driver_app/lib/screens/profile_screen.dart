import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import '../widgets/profile_sections.dart';
import 'intercity_screen.dart';
import 'support_screen.dart';

/// Driver profile: identity, badges, vehicle, documents, preferences, intercity, support and sign out.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.api, required this.onSignOut});
  final ApiClient api;
  final VoidCallback onSignOut;

  Future<Map<String, dynamic>> _load() async {
    final r = await Future.wait<dynamic>([api.get('/driver/me'), api.get('/driver/documents')]);
    return {'me': asMap(r[0]), 'docs': asList(r[1])};
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: AsyncBody<Map<String, dynamic>>(load: _load, builder: (context, data, refresh) {
        final me = asMap(data['me']);
        final docs = data['docs'] as List<Map<String, dynamic>>;
        return RefreshIndicator(
          onRefresh: refresh,
          child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
            ProfileHeader(me: me, badges: earnedBadges(me, docs)),
            const SectionTitle('Vehicle'),
            VehicleSection(vehicles: asList(me['vehicles'])),
            const SectionTitle('Documents'),
            DocumentsSection(docs: docs),
            const SectionTitle('Ride preferences'),
            PreferencesSection(api: api, prefs: asMap(me['preferences'])),
            const SectionTitle('More'),
            InfoTile(icon: Icons.alt_route, title: 'Intercity trips', subtitle: 'Post seats between cities', onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => IntercityScreen(api: api)))),
            const SizedBox(height: 8),
            InfoTile(icon: Icons.devices_outlined, title: 'Signed-in devices', subtitle: 'See and sign out other phones', onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SessionsScreen(api: api)))),
            InfoTile(icon: Icons.support_agent, title: 'Support', subtitle: 'Tickets and replies', onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SupportScreen(api: api)))),
            const SizedBox(height: 16),
            Text('Map data © OpenStreetMap contributors', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 16),
            OutlinedButton.icon(onPressed: () => _confirmSignOut(context), icon: const Icon(Icons.logout), label: const Text('Sign out'), style: OutlinedButton.styleFrom(foregroundColor: sosRed)),
          ]),
        );
      }),
    );
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You will stop receiving ride requests. Go offline first if you are online.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Stay')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out'))],
      ),
    );
    if (ok == true) onSignOut();
  }
}
