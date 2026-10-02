import 'package:flutter/material.dart';

const driverCancelReasons = {
  'PASSENGER_NO_SHOW': 'Rider did not show up',
  'PASSENGER_ASKED': 'Rider asked me to cancel',
  'VEHICLE_ISSUE': 'Problem with my vehicle',
  'SAFETY_CONCERN': 'I feel unsafe',
  'TOO_FAR': 'Pickup is too far',
  'OTHER': 'Other reason',
};

/// Bottom sheet that returns the chosen cancel reason code, or null if dismissed.
Future<String?> pickCancelReason(BuildContext context) => showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Why are you cancelling?', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text('Frequent cancellations can affect your access to ride requests.', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 8),
            for (final e in driverCancelReasons.entries) ListTile(minTileHeight: 56, title: Text(e.value), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.pop(context, e.key)),
            OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Keep the trip')),
          ])),
        ),
      ),
    );
