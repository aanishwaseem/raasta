import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

/// Trusted contacts. Trip sharing and SOS alerts go to these people.
class SafetyScreen extends StatefulWidget {
  const SafetyScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<SafetyScreen> createState() => _SafetyScreenState();
}

class _SafetyScreenState extends State<SafetyScreen> {
  List<Map<String, dynamic>>? _contacts;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.api.get('/me/emergency-contacts') as List;
      if (mounted) setState(() { _contacts = r.cast<Map<String, dynamic>>(); _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    }
  }

  Future<void> _add() async {
    final name = TextEditingController();
    final phone = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Add a trusted contact'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
          const SizedBox(height: 8),
          TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (+92...)')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Save'))],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.post('/me/emergency-contacts', body: {'name': name.text.trim(), 'phone': phone.text.trim(), 'shareByDefault': true});
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    }
  }

  Future<void> _remove(String id) async {
    try {
      await widget.api.delete('/me/emergency-contacts/$id');
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _contacts;
    return Scaffold(
      appBar: AppBar(title: const Text('Safety')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.person_add_alt), label: const Text('Add contact')),
      body: c == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : ListView(padding: const EdgeInsets.all(16), children: [
              const Text('Trusted contacts get your live trip link when you share a ride or press SOS.'),
              if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              if (c.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No contacts yet.'))),
              for (final x in c)
                ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.person)),
                  title: Text('${x['name']}'),
                  subtitle: Text('${x['phone']}'),
                  trailing: IconButton(tooltip: 'Remove', icon: const Icon(Icons.delete_outline), onPressed: () => _remove(x['id'] as String)),
                ),
            ]),
    );
  }
}
