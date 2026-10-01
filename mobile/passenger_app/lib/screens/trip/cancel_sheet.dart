import 'package:flutter/material.dart';

import '../../widgets/sheets.dart';

const cancelReasons = {
  'CHANGED_MIND': 'I changed my mind',
  'DRIVER_TOO_FAR': 'Driver is too far',
  'WAIT_TOO_LONG': 'Waiting too long',
  'WRONG_PICKUP': 'Wrong pickup location',
  'FOUND_OTHER_RIDE': 'Found another ride',
  'DRIVER_ASKED': 'Driver asked me to cancel',
  'SAFETY_CONCERN': 'I have a safety concern',
  'OTHER': 'Other reason',
};

/// Asks for a reason, then returns its code (null when the rider keeps the ride).
Future<String?> askCancelReason(BuildContext context, {required bool driverAssigned}) {
  return showAppSheet<String>(context, (c) => _CancelSheet(driverAssigned: driverAssigned));
}

class _CancelSheet extends StatefulWidget {
  const _CancelSheet({required this.driverAssigned});
  final bool driverAssigned;
  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
  String? _reason;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SheetTitle('Cancel this ride?', subtitle: widget.driverAssigned ? 'A small cancellation fee may apply if your driver has already been on the way for a while. No fee for safety concerns.' : 'No fee: no driver has been assigned yet.'),
      RadioGroup<String>(
        groupValue: _reason,
        onChanged: (v) => setState(() => _reason = v),
        child: Column(children: [for (final e in cancelReasons.entries) RadioListTile<String>(contentPadding: EdgeInsets.zero, value: e.key, title: Text(e.value))]),
      ),
      const SizedBox(height: 8),
      FilledButton(style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error), onPressed: _reason == null ? null : () => Navigator.pop(context, _reason), child: const Text('Cancel ride')),
      const SizedBox(height: 8),
      OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Keep my ride')),
    ]);
  }
}
