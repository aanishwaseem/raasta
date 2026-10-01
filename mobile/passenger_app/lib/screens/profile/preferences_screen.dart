import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../widgets/load_view.dart';
import '../../widgets/sheets.dart';

/// Notification channels and app language.
class PreferencesScreen extends StatefulWidget {
  const PreferencesScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<PreferencesScreen> createState() => _PreferencesScreenState();
}

class _PreferencesScreenState extends State<PreferencesScreen> {
  Json? _n;
  String? _locale;

  Future<(Json, String)> _load() async {
    final p = asJson(await widget.api.get('/me/preferences'));
    final me = asJson(await widget.api.get('/me'));
    return (asJson(p['notifications']), me['locale'] == 'ur' ? 'ur' : 'en');
  }

  Future<void> _setN(String key, bool v) async {
    final old = _n![key];
    setState(() => _n![key] = v);
    try {
      await widget.api.patch('/me/preferences', body: {'notifications': {key: v}});
    } on ApiException catch (e) {
      if (mounted) { setState(() => _n![key] = old); toast(context, e.friendly); }
    }
  }

  Future<void> _setLocale(String v) async {
    final old = _locale;
    setState(() => _locale = v);
    try {
      await widget.api.patch('/me', body: {'locale': v});
    } on ApiException catch (e) {
      if (mounted) { setState(() => _locale = old); toast(context, e.friendly); }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Preferences')),
      body: LoadView<(Json, String)>(
        load: _load,
        builder: (context, d, _) {
          _n ??= d.$1;
          _locale ??= d.$2;
          bool on(String k) => _n![k] == true;
          return [
            const SectionTitle('Notifications'),
            SwitchRow(title: 'Push notifications', subtitle: 'Driver updates, trip status and safety alerts.', value: on('push'), onChanged: (v) => _setN('push', v)),
            SwitchRow(title: 'SMS', subtitle: 'Text messages for ride and account updates.', value: on('sms'), onChanged: (v) => _setN('sms', v)),
            SwitchRow(title: 'Email', subtitle: 'Receipts and account emails.', value: on('email'), onChanged: (v) => _setN('email', v)),
            SwitchRow(title: 'Offers and news', subtitle: 'Promotions and product updates. Off by default.', value: on('marketing'), onChanged: (v) => _setN('marketing', v)),
            const SectionTitle('Language'),
            SegmentedButton<String>(segments: const [ButtonSegment(value: 'en', label: Text('English')), ButtonSegment(value: 'ur', label: Text('اردو'))], selected: {_locale!}, onSelectionChanged: (s) => _setLocale(s.first)),
            const Padding(padding: EdgeInsets.only(top: 8), child: Text('Language sets how Raasta Assistant replies. Safety alerts are always sent regardless of these settings.')),
          ];
        },
      ),
    );
  }
}
