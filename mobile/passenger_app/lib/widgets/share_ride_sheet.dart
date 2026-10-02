import 'package:flutter/material.dart';
import '../util/clipboard.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/json.dart';
import 'sheets.dart';

/// Share a live trip link: pick trusted contacts to text, and the link is also copied.
Future<void> showShareRideSheet(BuildContext context, ApiClient api, String rideId) =>
    showAppSheet<void>(context, (c) => ShareRideSheet(api: api, rideId: rideId));

class ShareRideSheet extends StatefulWidget {
  const ShareRideSheet({super.key, required this.api, required this.rideId});
  final ApiClient api;
  final String rideId;
  @override
  State<ShareRideSheet> createState() => _ShareRideSheetState();
}

class _ShareRideSheetState extends State<ShareRideSheet> {
  List<Json>? _contacts;
  final _picked = <String>{};
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final c = asJsonList(await widget.api.get('/me/emergency-contacts'));
      if (mounted) setState(() { _contacts = c; _picked.addAll([for (final x in c) if (x['shareByDefault'] == true) x['id'] as String]); _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _contacts = []; _error = e.friendly; });
    }
  }

  Future<void> _share() async {
    setState(() => _busy = true);
    try {
      final r = asJson(await widget.api.post('/rides/${widget.rideId}/share', body: {if (_picked.isNotEmpty) 'emergencyContactIds': _picked.toList()}));
      final url = r['url']?.toString();
      if (url != null) copyText(url);
      if (!mounted) return;
      final n = (r['recipients'] as num?)?.toInt() ?? 0;
      Navigator.pop(context);
      toast(context, 'Live trip link copied${n > 0 ? ' and sent to $n contact${n == 1 ? '' : 's'}' : ''}.');
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _contacts;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SheetTitle('Share your live trip', subtitle: 'People you pick get a text with a link to follow your ride. The link stops working a few hours after your trip.'),
      if (c == null) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
      if (c != null && c.isEmpty) const Padding(padding: EdgeInsets.only(bottom: 12), child: Text('You have no trusted contacts yet. You can still copy the link and send it yourself. Add contacts in the Safety tab.')),
      if (c != null)
        for (final x in c)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _picked.contains(x['id']),
            title: Text('${x['name']}'),
            subtitle: Text('${x['phone']}'),
            onChanged: (v) => setState(() => v == true ? _picked.add(x['id'] as String) : _picked.remove(x['id'])),
          ),
      if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      FilledButton.icon(onPressed: _busy || c == null ? null : _share, icon: const Icon(Icons.share_outlined), label: Text(_picked.isEmpty ? 'Copy trip link' : 'Share with ${_picked.length}')),
    ]);
  }
}
