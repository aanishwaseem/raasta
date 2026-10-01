import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

const luggagePolicies = {'NONE': 'No luggage', 'ONE_BAG': 'One bag', 'TWO_BAGS': 'Two bags', 'LARGE_ALLOWED': 'Large luggage allowed'};

/// Post a seat-share trip between cities (POST /driver/intercity/trips). Validation mirrors the API limits.
class IntercityForm extends StatefulWidget {
  const IntercityForm({super.key, required this.api, required this.routes});
  final ApiClient api;
  final List<Map<String, dynamic>> routes;
  @override
  State<IntercityForm> createState() => _IntercityFormState();
}

class _IntercityFormState extends State<IntercityForm> {
  final _form = GlobalKey<FormState>();
  late String _route = '${widget.routes.first['id']}';
  DateTime? _when;
  final _pickup = TextEditingController();
  final _drop = TextEditingController();
  final _seats = TextEditingController(text: '3');
  late final _fare = TextEditingController(text: '${widget.routes.first['suggestedSeatFare'] ?? ''}');
  String _luggage = 'ONE_BAG';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_pickup, _drop, _seats, _fare]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickWhen() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _when ?? now.add(const Duration(days: 1)), firstDate: now, lastDate: now.add(const Duration(days: 60)));
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_when ?? now));
    if (t != null) setState(() => _when = DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  String? _range(String? v, int lo, int hi, String what) {
    final n = int.tryParse((v ?? '').trim());
    return n == null || n < lo || n > hi ? '$what must be between $lo and $hi' : null;
  }

  Future<void> _submit() async {
    final valid = _form.currentState!.validate();
    if (_when == null || _when!.isBefore(DateTime.now())) {
      setState(() => _error = 'Choose a departure time in the future.');
      return;
    }
    if (!valid) return;
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/driver/intercity/trips', body: {'routeId': _route, 'departureAt': _when!.toUtc().toIso8601String(), 'pickupPoint': _pickup.text.trim(), 'dropoffPoint': _drop.text.trim(), 'seatsTotal': int.parse(_seats.text.trim()), 'seatFare': int.parse(_fare.text.trim()), 'luggagePolicy': _luggage});
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _error = errorText(e); _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.viewInsetsOf(context).bottom + 16),
      child: SingleChildScrollView(child: Form(key: _form, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Post an intercity trip', style: t.textTheme.titleLarge),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _route,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Route'),
          items: [for (final r in widget.routes) DropdownMenuItem(value: '${r['id']}', child: Text('${r['origin']} to ${r['destination']}'))],
          onChanged: (v) => setState(() { _route = v!; _fare.text = '${widget.routes.firstWhere((r) => '${r['id']}' == v)['suggestedSeatFare'] ?? _fare.text}'; }),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(onPressed: _pickWhen, icon: const Icon(Icons.event), label: Text(_when == null ? 'Choose departure date and time' : '${dayLabel(_when!)} at ${clock(_when!)}')),
        const SizedBox(height: 12),
        TextFormField(controller: _pickup, maxLength: 120, decoration: const InputDecoration(labelText: 'Pickup point'), validator: (v) => (v ?? '').trim().isEmpty ? 'Enter a pickup point' : null),
        TextFormField(controller: _drop, maxLength: 120, decoration: const InputDecoration(labelText: 'Drop-off point'), validator: (v) => (v ?? '').trim().isEmpty ? 'Enter a drop-off point' : null),
        Row(children: [
          Expanded(child: TextFormField(controller: _seats, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Seats (1-11)'), validator: (v) => _range(v, 1, 11, 'Seats'))),
          const SizedBox(width: 12),
          Expanded(child: TextFormField(controller: _fare, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Fare per seat (Rs)'), validator: (v) => _range(v, 100, 20000, 'Fare'))),
        ]),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: _luggage, decoration: const InputDecoration(labelText: 'Luggage'), items: [for (final e in luggagePolicies.entries) DropdownMenuItem(value: e.key, child: Text(e.value))], onChanged: (v) => setState(() => _luggage = v!)),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: t.colorScheme.error, fontWeight: FontWeight.w600))),
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy ? null : _submit, child: _busy ? const CircularProgressIndicator() : const Text('Post trip')),
      ]))),
    );
  }
}
