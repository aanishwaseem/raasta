import 'package:flutter/material.dart';

/// Identity form (CNIC, date of birth, licence, city, gender). Returns the API body or null.
class IdentitySheet extends StatefulWidget {
  const IdentitySheet({super.key, required this.cities});
  final List<Map<String, dynamic>> cities;
  @override
  State<IdentitySheet> createState() => _IdentitySheetState();
}

class _IdentitySheetState extends State<IdentitySheet> {
  final _form = GlobalKey<FormState>();
  final _cnic = TextEditingController();
  final _lic = TextEditingController();
  DateTime? _dob;
  late String _city = '${widget.cities.first['id']}';
  String _gender = 'UNDISCLOSED';
  bool _dobMissing = false;

  @override
  void dispose() {
    _cnic.dispose();
    _lic.dispose();
    super.dispose();
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _dob ?? DateTime(now.year - 30), firstDate: DateTime(now.year - 80), lastDate: DateTime(now.year - 18, now.month, now.day), helpText: 'Date of birth');
    if (d != null) setState(() { _dob = d; _dobMissing = false; });
  }

  void _save() {
    final ok = _form.currentState!.validate();
    if (_dob == null) setState(() => _dobMissing = true);
    if (!ok || _dob == null) return;
    final d = _dob!;
    Navigator.pop(context, {'cnicNumber': _cnic.text.trim(), 'dateOfBirth': '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}', 'licenseNumber': _lic.text.trim(), 'cityId': _city, 'gender': _gender});
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.viewInsetsOf(context).bottom + 16),
      child: SingleChildScrollView(child: Form(key: _form, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Your identity', style: t.textTheme.titleLarge),
        const SizedBox(height: 12),
        TextFormField(controller: _cnic, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'CNIC', hintText: '35202-1234567-1'), validator: (v) => RegExp(r'^\d{5}-?\d{7}-?\d$').hasMatch((v ?? '').trim()) ? null : 'CNIC must be 13 digits'),
        const SizedBox(height: 12),
        OutlinedButton.icon(onPressed: _pickDob, icon: const Icon(Icons.cake_outlined), label: Text(_dob == null ? 'Choose date of birth' : '${_dob!.day}/${_dob!.month}/${_dob!.year}')),
        if (_dobMissing) Padding(padding: const EdgeInsets.only(top: 4, left: 12), child: Text('Choose your date of birth (18 or older)', style: TextStyle(color: t.colorScheme.error, fontSize: 12))),
        const SizedBox(height: 12),
        TextFormField(controller: _lic, decoration: const InputDecoration(labelText: 'Driving licence number'), validator: (v) => (v ?? '').trim().length < 5 || v!.trim().length > 30 ? 'Enter 5 to 30 characters' : null),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: _city, decoration: const InputDecoration(labelText: 'City'), items: [for (final c in widget.cities) DropdownMenuItem(value: '${c['id']}', child: Text('${c['name']}'))], onChanged: (v) => setState(() => _city = v!)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: _gender, decoration: const InputDecoration(labelText: 'Gender'), items: const [DropdownMenuItem(value: 'FEMALE', child: Text('Female')), DropdownMenuItem(value: 'MALE', child: Text('Male')), DropdownMenuItem(value: 'OTHER', child: Text('Other')), DropdownMenuItem(value: 'UNDISCLOSED', child: Text('Prefer not to say'))], onChanged: (v) => setState(() => _gender = v!)),
        const SizedBox(height: 16),
        FilledButton(onPressed: _save, child: const Text('Save identity')),
      ]))),
    );
  }
}

/// Vehicle form. Returns the API body or null.
class VehicleSheet extends StatefulWidget {
  const VehicleSheet({super.key});
  @override
  State<VehicleSheet> createState() => _VehicleSheetState();
}

class _VehicleSheetState extends State<VehicleSheet> {
  final _form = GlobalKey<FormState>();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _year = TextEditingController();
  final _color = TextEditingController();
  final _plate = TextEditingController();
  final _seats = TextEditingController(text: '4');
  String _class = 'ECONOMY';

  @override
  void dispose() {
    for (final c in [_make, _model, _year, _color, _plate, _seats]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _len(String? v, int lo, int hi, String what) => (v ?? '').trim().length < lo || v!.trim().length > hi ? '$what needs $lo to $hi characters' : null;

  void _save() {
    if (!_form.currentState!.validate()) return;
    Navigator.pop(context, {'vehicleClass': _class, 'make': _make.text.trim(), 'model': _model.text.trim(), 'year': int.parse(_year.text.trim()), 'color': _color.text.trim(), 'plateNumber': _plate.text.trim(), 'seats': int.parse(_seats.text.trim())});
  }

  @override
  Widget build(BuildContext context) {
    Widget f(TextEditingController c, String l, String? Function(String?) v, {bool num = false, String? hint}) => Padding(padding: const EdgeInsets.only(bottom: 12), child: TextFormField(controller: c, keyboardType: num ? TextInputType.number : null, decoration: InputDecoration(labelText: l, hintText: hint), validator: v));
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.viewInsetsOf(context).bottom + 16),
      child: SingleChildScrollView(child: Form(key: _form, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Your vehicle', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: _class, decoration: const InputDecoration(labelText: 'Type'), items: [for (final g in ['BIKE', 'ECONOMY', 'COMFORT', 'PREMIUM', 'XL']) DropdownMenuItem(value: g, child: Text(g[0] + g.substring(1).toLowerCase()))], onChanged: (v) => setState(() { _class = v!; _seats.text = v == 'BIKE' ? '1' : '4'; })),
        const SizedBox(height: 12),
        f(_make, 'Make', (v) => _len(v, 2, 40, 'Make'), hint: 'Suzuki'),
        f(_model, 'Model', (v) => _len(v, 1, 40, 'Model'), hint: 'Cultus'),
        f(_year, 'Year', (v) { final n = int.tryParse((v ?? '').trim()); return n == null || n < 1990 || n > DateTime.now().year + 1 ? 'Enter a year from 1990' : null; }, num: true),
        f(_color, 'Colour', (v) => _len(v, 3, 30, 'Colour')),
        f(_plate, 'Number plate', (v) => RegExp(r'^[A-Za-z0-9 -]{4,15}$').hasMatch((v ?? '').trim()) ? null : 'Use 4 to 15 letters, digits, spaces or dashes', hint: 'LEA-19-1234'),
        f(_seats, 'Passenger seats', (v) { final n = int.tryParse((v ?? '').trim()); return n == null || n < 1 || n > 12 ? 'Seats must be 1 to 12' : null; }, num: true),
        FilledButton(onPressed: _save, child: const Text('Save vehicle')),
      ]))),
    );
  }
}
