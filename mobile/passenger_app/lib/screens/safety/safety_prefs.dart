import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../widgets/sheets.dart';

/// Women's safety and trip-protection switches (PATCH /me/preferences, safety block).
class SafetyPrefs extends StatefulWidget {
  const SafetyPrefs({super.key, required this.api, required this.initial});
  final ApiClient api;
  final Json initial;
  @override
  State<SafetyPrefs> createState() => _SafetyPrefsState();
}

class _SafetyPrefsState extends State<SafetyPrefs> {
  late final Json _v = {'autoShareWithContacts': widget.initial['autoShareWithContacts'] == true, 'routeDeviationAlerts': widget.initial['routeDeviationAlerts'] != false, 'preferFemaleDriver': widget.initial['preferFemaleDriver'] == true};

  Future<void> _set(String key, bool v) async {
    final old = _v[key];
    setState(() => _v[key] = v);
    try {
      await widget.api.patch('/me/preferences', body: {'safety': {key: v}});
    } on ApiException catch (e) {
      if (mounted) { setState(() => _v[key] = old); toast(context, e.friendly); }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Column(children: [
          SwitchRow(title: 'Auto-share trips with trusted contacts', subtitle: 'Contacts marked "share automatically" get your live trip link when a ride starts.', value: _v['autoShareWithContacts'] == true, onChanged: (v) => _set('autoShareWithContacts', v)),
          SwitchRow(title: 'Route deviation alerts', subtitle: 'Ask "Are you safe?" if your trip strays from the planned route.', value: _v['routeDeviationAlerts'] == true, onChanged: (v) => _set('routeDeviationAlerts', v)),
          SwitchRow(title: 'Prefer a woman driver', subtitle: 'Honoured when drivers are available nearby. It is never guaranteed.', value: _v['preferFemaleDriver'] == true, onChanged: (v) => _set('preferFemaleDriver', v)),
        ]),
      ),
    );
  }
}
