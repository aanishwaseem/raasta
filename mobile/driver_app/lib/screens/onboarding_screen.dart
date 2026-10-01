import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import '../widgets/onboarding_forms.dart';
import '../widgets/onboarding_stepper.dart';
import '../widgets/training_card.dart';

/// Onboarding driven by the API's own checklist, so the app never disagrees with what review requires.
/// Also covers the waiting states: in review, rejected (with reasons), suspended, and the training step.
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
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
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
    try {
      final cities = asList(await widget.api.get('/cities'));
      if (!mounted) return;
      if (cities.isEmpty) return setState(() => _error = 'No cities are available yet. Please try again later.');
      final v = await showModalBottomSheet<Map<String, String>>(context: context, isScrollControlled: true, builder: (_) => IdentitySheet(cities: cities));
      if (v != null) await _run(() async => widget.api.post('/driver/onboarding/identity', body: v));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  Future<void> _vehicle() async {
    final v = await showModalBottomSheet<Map<String, dynamic>>(context: context, isScrollControlled: true, builder: (_) => const VehicleSheet());
    if (v != null) await _run(() async => widget.api.post('/driver/vehicles', body: v));
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    final status = '${me['status']}';
    final checklist = asList(me['checklist']).where((c) => c['key'] != 'TRAINING').toList();
    final todo = checklist.where((c) => c['key'] != 'REVIEW' && !_done.contains(c['status']) && c['status'] != 'PENDING');
    final inReview = status == 'PENDING_REVIEW';
    final approved = status == 'APPROVED';
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Become a driver'), actions: [IconButton(tooltip: 'Refresh', icon: const Icon(Icons.refresh), onPressed: widget.onChanged), IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: widget.onSignOut)]),
      body: RefreshIndicator(
        onRefresh: widget.onChanged,
        child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
          OnboardingStepper(steps: onboardingSteps(me)),
          const SizedBox(height: 16),
          if (inReview) const _Notice(icon: Icons.hourglass_top, color: raastaAmber, title: 'Application in review', body: 'The Raasta team is checking your documents. This usually takes a short while. Pull down to check for updates.'),
          if (status == 'REJECTED') _Notice(icon: Icons.error_outline, color: sosRed, title: 'Your application needs changes', body: '${me['reviewNotes'] ?? 'Please fix the items marked below and submit again.'}'),
          if (status == 'SUSPENDED') const _Notice(icon: Icons.block, color: sosRed, title: 'Account suspended', body: 'Your account is suspended. Contact Raasta support for help.'),
          if (approved) TrainingCard(api: widget.api, onDone: widget.onChanged),
          if (!approved) ...[
            for (final c in checklist)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: InfoTile(
                  icon: statusStyle('${c['status']}').icon,
                  color: statusStyle('${c['status']}').color,
                  title: '${c['label']}',
                  subtitle: _subtitle(c),
                  trailing: _trailing(c, inReview || status == 'SUSPENDED' || _busy),
                ),
              ),
            if (_error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_error!, style: TextStyle(color: t.colorScheme.error, fontWeight: FontWeight.w600))),
            const SizedBox(height: 8),
            if (!inReview && status != 'SUSPENDED') FilledButton(onPressed: _busy || todo.isNotEmpty ? null : () => _run(() async => widget.api.post('/driver/onboarding/submit')), child: const Text('Submit for review')),
            if (todo.isNotEmpty && !inReview) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${todo.length} step${todo.length == 1 ? '' : 's'} left before you can submit.', textAlign: TextAlign.center, style: t.textTheme.bodySmall)),
          ],
          if (approved && _error != null) Text(_error!, style: TextStyle(color: t.colorScheme.error)),
        ]),
      ),
    );
  }

  Widget? _trailing(Map<String, dynamic> c, bool locked) {
    final key = '${c['key']}', s = '${c['status']}';
    if (locked || key == 'REVIEW') return statusChip(s);
    final label = s == 'MISSING' ? (_docKeys.contains(key) ? 'Upload' : 'Add') : (_docKeys.contains(key) ? 'Replace' : 'Redo');
    VoidCallback? go = switch (key) { 'IDENTITY' => _identity, 'VEHICLE' => _vehicle, _ => _docKeys.contains(key) ? () => _upload(key) : null };
    if (go == null) return statusChip(s);
    return FilledButton.tonal(onPressed: go, style: FilledButton.styleFrom(minimumSize: const Size(88, 48)), child: Text(label));
  }

  String _subtitle(Map<String, dynamic> c) {
    final s = '${c['status']}';
    final note = c['note'];
    return switch (s) { 'MISSING' => 'Not done yet', 'PENDING' => 'Waiting for review', 'REJECTED' => 'Rejected${note != null ? ': $note' : ''}', 'EXPIRED' => 'Expired. Please upload a new one', _ => 'Done' };
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.color, required this.title, required this.body});
  final IconData icon;
  final Color color;
  final String title;
  final String body;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(16), border: Border.all(color: color)),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 4), Text(body)])),
          ]),
        ),
      );
}
