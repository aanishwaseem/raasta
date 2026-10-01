import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import 'pin_pad.dart';

Widget _bigButton(String label, VoidCallback? onTap, {Color? color, bool busy = false, IconData? icon}) => FilledButton.icon(
      onPressed: onTap,
      icon: busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 3)) : Icon(icon ?? Icons.check),
      label: Text(label),
      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(68), backgroundColor: color, foregroundColor: color == null ? null : Colors.black, textStyle: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
    );

class _PassengerRow extends StatelessWidget {
  const _PassengerRow({required this.ride, this.trailing});
  final Map<String, dynamic> ride;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    final p = asMap(ride['passenger']);
    final t = Theme.of(context);
    return Row(children: [
      CircleAvatar(radius: 24, backgroundColor: t.colorScheme.primary.withValues(alpha: 0.2), child: Text(('${p['firstName'] ?? 'R'}')[0].toUpperCase(), style: t.textTheme.titleLarge)),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${p['firstName'] ?? 'Rider'}', style: t.textTheme.titleMedium),
        if (p['rating'] != null) Text('${dbl(p['rating']).toStringAsFixed(1)} ★ rider', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant)),
      ])),
      ?trailing,
    ]);
  }
}

class _Address extends StatelessWidget {
  const _Address(this.icon, this.color, this.label, this.text);
  final IconData icon;
  final Color color;
  final String label;
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Icon(icon, color: color),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: Theme.of(context).textTheme.labelSmall), Text(text, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodyLarge)])),
        ]),
      );
}

/// Heading to the pickup: shows where, how far, and the single next action.
class PickupPanel extends StatelessWidget {
  const PickupPanel({super.key, required this.ride, required this.distanceM, required this.busy, required this.onArrived, required this.onCancel});
  final Map<String, dynamic> ride;
  final double? distanceM;
  final bool busy;
  final VoidCallback onArrived;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final pickup = asMap(ride['pickup']);
    final eta = ride['etas'] is Map ? asMap(ride['etas'])['pickupEtaS'] : null;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _PassengerRow(ride: ride, trailing: distanceM == null ? null : StatusPill('${km(distanceM)} away${eta == null ? '' : ' · ${minutes(eta as num)}'}')),
      const SizedBox(height: 8),
      _Address(Icons.trip_origin, goGreen, 'PICKUP', '${pickup['address'] ?? ''}'),
      _Address(Icons.location_on, raastaAmber, 'DROP-OFF', '${asMap(ride['dropoff'])['address'] ?? ''}'),
      const SizedBox(height: 12),
      _bigButton("I've arrived", busy ? null : onArrived, color: goGreen, busy: busy, icon: Icons.flag),
      TextButton(onPressed: busy ? null : onCancel, style: TextButton.styleFrom(minimumSize: const Size.fromHeight(56), foregroundColor: sosRed), child: const Text('Cancel trip')),
    ]);
  }
}

/// At the pickup: the rider reads out their PIN, the driver enters it to start.
class PinPanel extends StatefulWidget {
  const PinPanel({super.key, required this.ride, required this.busy, required this.error, required this.onStart, required this.onCancel});
  final Map<String, dynamic> ride;
  final bool busy;
  final String? error;
  final ValueChanged<String> onStart;
  final VoidCallback onCancel;

  @override
  State<PinPanel> createState() => _PinPanelState();
}

class _PinPanelState extends State<PinPanel> {
  String _pin = '';

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _PassengerRow(ride: widget.ride),
      const SizedBox(height: 8),
      Text('Ask the rider for their 4-digit Ride PIN', textAlign: TextAlign.center, style: t.textTheme.titleMedium),
      const SizedBox(height: 12),
      PinPad(value: _pin, enabled: !widget.busy, onChanged: (v) => setState(() => _pin = v)),
      if (widget.error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(widget.error!, textAlign: TextAlign.center, style: TextStyle(color: t.colorScheme.error, fontWeight: FontWeight.w700))),
      _bigButton('Start trip', widget.busy || _pin.length != 4 ? null : () => widget.onStart(_pin), color: goGreen, busy: widget.busy, icon: Icons.play_arrow),
      TextButton(onPressed: widget.busy ? null : widget.onCancel, style: TextButton.styleFrom(minimumSize: const Size.fromHeight(56), foregroundColor: sosRed), child: const Text('Cancel trip (rider not here)')),
    ]);
  }
}

/// During the trip: progress toward the drop-off and the Complete action.
class ProgressPanel extends StatelessWidget {
  const ProgressPanel({super.key, required this.ride, required this.remainingM, required this.busy, required this.onComplete});
  final Map<String, dynamic> ride;
  final double? remainingM;
  final bool busy;
  final VoidCallback onComplete;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final total = dbl(ride['distanceM']);
    final progress = remainingM == null || total <= 0 ? null : (1 - remainingM! / total).clamp(0.0, 1.0);
    final cash = ride['paymentMethod'] == 'CASH';
    final payable = asMap(ride['fare'])['payable'];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: Text('Trip in progress', style: t.textTheme.titleLarge)),
        if (remainingM != null) Text('${km(remainingM)} left', style: t.textTheme.titleMedium?.copyWith(color: t.colorScheme.primary)),
      ]),
      const SizedBox(height: 8),
      ClipRRect(borderRadius: BorderRadius.circular(8), child: LinearProgressIndicator(value: progress, minHeight: 12)),
      const SizedBox(height: 12),
      _Address(Icons.location_on, raastaAmber, 'DROP-OFF', '${asMap(ride['dropoff'])['address'] ?? ''}'),
      if (cash) Padding(padding: const EdgeInsets.only(top: 4), child: StatusPill('Collect ${money(payable as num?)} cash at the end', color: raastaAmber)),
      const SizedBox(height: 12),
      _bigButton('Complete trip', busy ? null : onComplete, color: goGreen, busy: busy, icon: Icons.flag_circle),
    ]);
  }
}

/// The ride ended without a completion: cancelled by the rider, the driver or the system.
class EndedPanel extends StatelessWidget {
  const EndedPanel({super.key, required this.ride, required this.onDone});
  final Map<String, dynamic> ride;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final by = asMap(ride['cancellation'])['by'];
    final status = '${ride['status']}';
    final text = status == 'CANCELLED' ? (by == 'PASSENGER' ? 'The rider cancelled this trip. You are free to take new requests.' : 'This trip was cancelled.') : 'This trip is no longer active (${prettyStatus(status)}).';
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        EmptyState(icon: Icons.event_busy, title: status == 'CANCELLED' ? 'Trip cancelled' : 'Trip ended', message: text),
        FilledButton(onPressed: onDone, child: const Text('Back to driving')),
      ]),
    );
  }
}
