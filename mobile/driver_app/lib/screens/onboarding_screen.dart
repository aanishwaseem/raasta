import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

/// Onboarding checklist driven by the API's own checklist, so the app never disagrees with what review requires.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.api, required this.me, required this.onChanged, required this.onSignOut});
  final ApiClient api;
  final Map<String, dynamic> me;
  final Future<void> Function() onChanged;
  final VoidCallback onSignOut;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  String? _error;
  bool _busy = false;

  static const _done = {'DONE', 'OK', 'APPROVED'};
  static const _docKeys = {'CNIC_FRONT', 'CNIC_BACK', 'DRIVING_LICENSE', 'PROFILE_PHOTO', 'VEHICLE_REGISTRATION', 'VEHICLE_PHOTO'};

  Future<void> _run(Future<void> Function() fn) async {
    setState(() { _busy = true; _error = null; });
    try {
      await fn();
      await widget.onChanged();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _upload(String docType) => _run(() async {
        final r = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'], withData: true);
        final f = r?.files.single;
        if (f == null || f.bytes == null) return;
        final vehicleId = widget.me['currentVehicleId'] as String?;
        final isVehicleDoc = docType == 'VEHICLE_REGISTRATION' || docType == 'VEHICLE_PHOTO';
        await widget.api.upload('/driver/documents', fields: {'docType': docType, if (isVehicleDoc && vehicleId != null) 'vehicleId': vehicleId}, bytes: f.bytes!, filename: f.name);
      });

  Future<void> _identity() async {
    final cities = (await widget.api.get('/cities') as List).cast<Map<String, dynamic>>();
    if (!mounted) return;
    final v = await showDialog<Map<String, String>>(context: context, builder: (_) => _IdentityDialog(cities: cities));
    if (v == null) return;
    await _run(() async => widget.api.post('/driver/onboarding/identity', body: v));
  }

  Future<void> _vehicle() async {
    final v = await showDialog<Map<String, dynamic>>(context: context, builder: (_) => const _VehicleDialog());
    if (v == null) return;
    await _run(() async => widget.api.post('/driver/vehicles', body: v));
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    final status = me['status'] as String;
    final checklist = (me['checklist'] as List).cast<Map<String, dynamic>>().where((c) => c['key'] != 'TRAINING').toList();
    final todo = checklist.where((c) => c['key'] != 'REVIEW' && !_done.contains(c['status']) && c['status'] != 'PENDING');
    final inReview = status == 'PENDING_REVIEW';
    return Scaffold(
      appBar: AppBar(title: const Text('Become a driver'), actions: [IconButton(tooltip: 'Refresh', icon: const Icon(Icons.refresh), onPressed: widget.onChanged), IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: widget.onSignOut)]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (inReview) Card(color: Theme.of(context).colorScheme.primaryContainer, child: const Padding(padding: EdgeInsets.all(16), child: Text('Your application is with the Raasta team. We will review it shortly. Pull to refresh or tap the refresh icon to check.'))),
        if (status == 'REJECTED') Card(color: Theme.of(context).colorScheme.errorContainer, child: Padding(padding: const EdgeInsets.all(16), child: Text('Your application needs changes. ${me['reviewNotes'] ?? ''}'))),
        if (status == 'SUSPENDED') const Card(child: Padding(padding: EdgeInsets.all(16), child: Text('Your account is suspended. Contact support.'))),
        for (final c in checklist)
          ListTile(
            leading: Icon(_icon(c['status'] as String), color: _color(context, c['status'] as String)),
            title: Text(c['label'] as String),
            subtitle: Text(_subtitle(c)),
            trailing: inReview || status == 'SUSPENDED' || c['key'] == 'REVIEW' || _busy ? null : _action(c['key'] as String, c['status'] as String),
          ),
        if (_error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 12),
        if (!inReview && status != 'SUSPENDED') FilledButton(onPressed: _busy || todo.isNotEmpty ? null : () => _run(() async => widget.api.post('/driver/onboarding/submit')), child: const Text('Submit for review')),
      ]),
    );
  }

  Widget? _action(String key, String status) {
    final label = status == 'MISSING' ? 'Add' : 'Redo';
    if (key == 'IDENTITY') return TextButton(onPressed: _identity, child: Text(label));
    if (key == 'VEHICLE') return TextButton(onPressed: _vehicle, child: Text(label));
    if (_docKeys.contains(key)) return TextButton(onPressed: () => _upload(key), child: Text(status == 'MISSING' ? 'Upload' : 'Replace'));
    return null;
  }

  IconData _icon(String s) => switch (s) { 'DONE' || 'OK' || 'APPROVED' => Icons.check_circle, 'PENDING' => Icons.hourglass_top, 'REJECTED' || 'EXPIRED' => Icons.error_outline, _ => Icons.radio_button_unchecked };
  Color? _color(BuildContext c, String s) => switch (s) { 'DONE' || 'OK' || 'APPROVED' => Colors.green.shade700, 'REJECTED' || 'EXPIRED' => Theme.of(c).colorScheme.error, 'PENDING' => raastaAmber, _ => null };
  String _subtitle(Map<String, dynamic> c) {
    final s = c['status'] as String;
    final note = c['note'];
    return switch (s) { 'MISSING' => 'Not done yet', 'PENDING' => 'Waiting for review', 'REJECTED' => 'Rejected${note != null ? ': $note' : ''}', 'EXPIRED' => 'Expired', _ => 'Done' };
  }
}

class _IdentityDialog extends StatefulWidget {
  const _IdentityDialog({required this.cities});
  final List<Map<String, dynamic>> cities;

  @override
  State<_IdentityDialog> createState() => _IdentityDialogState();
}

class _IdentityDialogState extends State<_IdentityDialog> {
  final _cnic = TextEditingController();
  final _dob = TextEditingController();
  final _lic = TextEditingController();
  late String _city = widget.cities.first['id'] as String;
  String _gender = 'UNDISCLOSED';

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Your identity'),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: _cnic, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'CNIC (35202-1234567-1)')),
          const SizedBox(height: 8),
          TextField(controller: _dob, decoration: const InputDecoration(labelText: 'Date of birth (YYYY-MM-DD)')),
          const SizedBox(height: 8),
          TextField(controller: _lic, decoration: const InputDecoration(labelText: 'Licence number')),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(initialValue: _city, decoration: const InputDecoration(labelText: 'City'), items: [for (final c in widget.cities) DropdownMenuItem(value: c['id'] as String, child: Text(c['name'] as String))], onChanged: (v) => setState(() => _city = v!)),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(initialValue: _gender, decoration: const InputDecoration(labelText: 'Gender'), items: [for (final g in ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']) DropdownMenuItem(value: g, child: Text(g))], onChanged: (v) => setState(() => _gender = v!)),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(context, {'cnicNumber': _cnic.text.trim(), 'dateOfBirth': _dob.text.trim(), 'licenseNumber': _lic.text.trim(), 'cityId': _city, 'gender': _gender}), child: const Text('Save')),
      ],
    );
  }
}

class _VehicleDialog extends StatefulWidget {
  const _VehicleDialog();

  @override
  State<_VehicleDialog> createState() => _VehicleDialogState();
}

class _VehicleDialogState extends State<_VehicleDialog> {
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _year = TextEditingController();
  final _color = TextEditingController();
  final _plate = TextEditingController();
  String _class = 'ECONOMY';
  final _seats = TextEditingController(text: '4');

  @override
  Widget build(BuildContext context) {
    Widget f(TextEditingController c, String l, {bool num = false}) => Padding(padding: const EdgeInsets.only(bottom: 8), child: TextField(controller: c, keyboardType: num ? TextInputType.number : null, decoration: InputDecoration(labelText: l)));
    return AlertDialog(
      title: const Text('Your vehicle'),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(initialValue: _class, decoration: const InputDecoration(labelText: 'Type'), items: [for (final g in ['BIKE', 'ECONOMY', 'COMFORT', 'PREMIUM', 'XL']) DropdownMenuItem(value: g, child: Text(g))], onChanged: (v) => setState(() { _class = v!; _seats.text = v == 'BIKE' ? '1' : '4'; })),
          const SizedBox(height: 8),
          f(_make, 'Make (Suzuki)'), f(_model, 'Model (Cultus)'), f(_year, 'Year', num: true), f(_color, 'Colour'), f(_plate, 'Plate (LEA-19-1234)'), f(_seats, 'Passenger seats', num: true),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(
          onPressed: () => Navigator.pop(context, {'vehicleClass': _class, 'make': _make.text.trim(), 'model': _model.text.trim(), 'year': int.tryParse(_year.text) ?? 0, 'color': _color.text.trim(), 'plateNumber': _plate.text.trim(), 'seats': int.tryParse(_seats.text) ?? 0}),
          child: const Text('Save'),
        ),
      ],
    );
  }
}
