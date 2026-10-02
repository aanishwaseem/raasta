import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../widgets/sheets.dart';

/// Add or edit a trusted contact. Pops true when saved.
Future<bool?> showContactSheet(BuildContext context, ApiClient api, {Json? existing}) =>
    showAppSheet<bool>(context, (c) => ContactSheet(api: api, existing: existing));

class ContactSheet extends StatefulWidget {
  const ContactSheet({super.key, required this.api, this.existing});
  final ApiClient api;
  final Json? existing;
  @override
  State<ContactSheet> createState() => _ContactSheetState();
}

class _ContactSheetState extends State<ContactSheet> {
  late final _name = TextEditingController(text: '${widget.existing?['name'] ?? ''}');
  late final _phone = TextEditingController(text: '${widget.existing?['phone'] ?? ''}');
  late final _rel = TextEditingController(text: '${widget.existing?['relationship'] ?? ''}');
  late bool _share = widget.existing?['shareByDefault'] == true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _rel.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().length < 2 || _phone.text.trim().length < 7) {
      setState(() => _error = 'Enter a name and a phone number (for example +923001112233).');
      return;
    }
    setState(() { _busy = true; _error = null; });
    final body = {'name': _name.text.trim(), 'phone': _phone.text.trim(), if (_rel.text.trim().isNotEmpty) 'relationship': _rel.text.trim(), 'shareByDefault': _share};
    try {
      if (widget.existing == null) {
        await widget.api.post('/me/emergency-contacts', body: body);
      } else {
        await widget.api.patch('/me/emergency-contacts/${widget.existing!['id']}', body: body);
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SheetTitle(widget.existing == null ? 'Add a trusted contact' : 'Edit contact', subtitle: 'They get a live trip link when you share a ride or press SOS.'),
      TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name', prefixIcon: Icon(Icons.person_outline))),
      const SizedBox(height: 12),
      TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (+92...)', prefixIcon: Icon(Icons.phone_outlined))),
      const SizedBox(height: 12),
      TextField(controller: _rel, decoration: const InputDecoration(labelText: 'Relationship (optional)', prefixIcon: Icon(Icons.family_restroom_outlined))),
      SwitchRow(title: 'Share my trips automatically', subtitle: 'Send this person my live trip link whenever safety mode is on.', value: _share, onChanged: (v) => setState(() => _share = v)),
      if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save contact')),
    ]);
  }
}
