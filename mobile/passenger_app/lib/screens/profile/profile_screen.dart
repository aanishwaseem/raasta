import 'package:flutter/material.dart';
import '../../util/clipboard.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/account_api.dart';
import '../../util/json.dart';
import '../../widgets/load_view.dart';
import '../../widgets/sheets.dart';
import '../assistant/assistant_screen.dart';
import '../intercity/intercity_screen.dart';
import '../schedule/schedule_screen.dart';
import 'delete_account_dialog.dart';
import 'edit_profile_screen.dart';
import 'preferences_screen.dart';
import 'privacy_screen.dart';
import 'saved_places_screen.dart';
import 'support_screen.dart';

class _ProfileData {
  _ProfileData(this.me, this.stats);
  final Json me;
  final Json stats;
}

/// Account hub: profile, saved places, preferences, privacy controls, help, sign out and account deletion.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.api, required this.location, required this.onSignOut});
  final ApiClient api;
  final DeviceLocation location;
  final Future<void> Function() onSignOut;
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _view = GlobalKey<LoadViewState<_ProfileData>>();

  Future<_ProfileData> _load() async {
    final me = asJson(await widget.api.get('/me'));
    Json stats = {};
    try { stats = asJson(await widget.api.get('/me/stats')); } on ApiException {/* optional */}
    return _ProfileData(me, stats);
  }

  void _go(Widget w) => Navigator.push(context, MaterialPageRoute(builder: (_) => w)).then((_) => _view.currentState?.reload());

  Future<void> _signOut() async {
    if (await confirmDialog(context, title: 'Sign out?', message: 'You will need to sign in again to book rides.', confirm: 'Sign out')) await widget.onSignOut();
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(context: context, builder: (_) => const DeleteAccountDialog());
    if (ok != true || !mounted) return;
    try {
      await deleteMyAccount(widget.api);
      await widget.onSignOut();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: LoadView<_ProfileData>(key: _view, load: _load, builder: _body),
    );
  }

  List<Widget> _body(BuildContext context, _ProfileData d, Future<void> Function() reload) {
    final t = Theme.of(context);
    final me = d.me;
    final name = '${me['fullName'] ?? widget.api.session?.name ?? 'Rider'}';
    final contact = [me['phone'], me['email']].where((e) => e != null && '$e'.isNotEmpty).join(' · ');
    return [
      Row(children: [
        CircleAvatar(radius: 32, backgroundColor: t.colorScheme.primary, child: Text(name.isEmpty ? '?' : name[0].toUpperCase(), style: t.textTheme.headlineSmall?.copyWith(color: t.colorScheme.onPrimary))),
        const SizedBox(width: 16),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(name, style: t.textTheme.titleLarge), if (contact.isNotEmpty) Text(contact, style: t.textTheme.bodySmall)])),
        IconButton.filledTonal(tooltip: 'Edit profile', onPressed: () => _go(EditProfileScreen(api: widget.api, me: me)), icon: const Icon(Icons.edit_outlined)),
      ]),
      const SizedBox(height: 16),
      Row(children: [
        Expanded(child: StatTile(label: 'Trips', value: '${d.stats['completedRides'] ?? 0}', icon: Icons.local_taxi_outlined)),
        const SizedBox(width: 8),
        Expanded(child: StatTile(label: 'Distance', value: '${d.stats['distanceKm'] ?? 0} km', icon: Icons.route_outlined)),
        const SizedBox(width: 8),
        Expanded(child: StatTile(label: 'Saved', value: money(d.stats['promoSavings'] as num? ?? 0), icon: Icons.local_offer_outlined)),
      ]),
      if (me['referralCode'] != null) ...[
        const SizedBox(height: 8),
        InfoTile(icon: Icons.card_giftcard, title: 'Invite friends: ${me['referralCode']}', subtitle: 'Tap to copy your referral code', color: raastaAmber, onTap: () { copyText('${me['referralCode']}'); toast(context, 'Referral code copied.'); }),
      ],
      const SectionTitle('Account'),
      _tile(Icons.bookmark_outline, 'Saved places', 'Home, work and favourites', () => _go(SavedPlacesScreen(api: widget.api))),
      _tile(Icons.schedule, 'Scheduled rides', 'Upcoming and recurring commutes', () => _go(ScheduleScreen(api: widget.api, location: widget.location))),
      _tile(Icons.alt_route, 'Intercity seats', 'Share a car between cities', () => _go(IntercityScreen(api: widget.api))),
      _tile(Icons.auto_awesome_outlined, 'Raasta Assistant', 'Book by typing or dictating', () => _go(AssistantScreen(api: widget.api, location: widget.location))),
      _tile(Icons.tune, 'Preferences', 'Notifications and language', () => _go(PreferencesScreen(api: widget.api))),
      _tile(Icons.privacy_tip_outlined, 'Privacy and personalization', 'Consents, your data, smart suggestions', () => _go(PrivacyScreen(api: widget.api))),
      _tile(Icons.devices_outlined, 'Signed-in devices', 'See and sign out other phones', () => _go(SessionsScreen(api: widget.api))),
      _tile(Icons.support_agent_outlined, 'Help and support', 'Tickets and replies', () => _go(SupportScreen(api: widget.api))),
      const SectionTitle('Session'),
      _tile(Icons.logout, 'Sign out', null, _signOut),
      _tile(Icons.delete_forever_outlined, 'Delete account', 'Permanently remove your account', _delete, color: t.colorScheme.error),
    ];
  }

  Widget _tile(IconData i, String title, String? sub, VoidCallback onTap, {Color? color}) => Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(icon: i, title: title, subtitle: sub, onTap: onTap, color: color));
}
