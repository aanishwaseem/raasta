import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:raasta_core/raasta_core.dart';

import '../logic/drive_controller.dart';
import '../util.dart';
import '../widgets/banners.dart';
import '../widgets/copilot_chip.dart';
import '../widgets/driver_map.dart';
import '../widgets/offer_card.dart';
import '../widgets/online_toggle.dart';
import '../widgets/sos_button.dart';
import '../widgets/stats_strip.dart';
import 'trip_screen.dart';

/// Home of the app: full-bleed map, online switch, today's numbers, incoming offers and the copilot hint.
class DriveScreen extends StatefulWidget {
  const DriveScreen({super.key, required this.api, required this.location});
  final ApiClient api;
  final DeviceLocation location;

  @override
  State<DriveScreen> createState() => _DriveScreenState();
}

class _DriveScreenState extends State<DriveScreen> {
  late final DriveController _c = DriveController(widget.api, widget.location)..onTrip = _openTrip..addListener(_onChange);
  bool _tripOpen = false;

  @override
  void initState() {
    super.initState();
    _c.init();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _onChange() {
    final n = _c.notice;
    if (n != null && mounted) {
      _c.clearNotice();
      toast(context, n);
    }
  }

  Future<void> _openTrip(String rideId) async {
    if (_tripOpen || !mounted) return;
    _tripOpen = true;
    final result = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => DriverTripScreen(api: widget.api, location: widget.location, rideId: rideId)));
    _tripOpen = false;
    if (!mounted) return;
    if (result == 'cancelled') toast(context, 'Trip cancelled.');
    _c.offer = null;
    _c.loadCopilot();
    _c.pollOffer();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(listenable: _c, builder: (context, _) {
      final pos = _c.pos;
      final center = pos == null ? const LatLng(31.5204, 74.3587) : LatLng(pos.lat, pos.lng);
      final o = _c.offer;
      final recs = _c.recommendations;
      return Stack(children: [
        Positioned.fill(child: DriverMap(attribution: false, center: center, fitKey: o == null ? null : '${o['offerId']}', pins: [if (o != null && o['pickup'] is Map) MapPin(dbl(o['pickup']['lat']), dbl(o['pickup']['lng']), icon: Icons.trip_origin, color: goGreen, label: 'Pickup')])),
        Positioned(
          top: 0, left: 0, right: 0,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: _StatusCard(online: _c.online, hasOffer: o != null)),
                  const SizedBox(width: 12),
                  SosButton(api: widget.api, location: widget.location, position: pos),
                ]),
                if (_c.networkDown) Padding(padding: const EdgeInsets.only(top: 8), child: NetworkBanner(onRetry: () { _c.loadCopilot(); _c.pollOffer(); })),
                if (_c.gpsProblem != null) Padding(padding: const EdgeInsets.only(top: 8), child: GpsBanner(problem: _c.gpsProblem!, onRetry: _c.refreshLocation)),
                const SizedBox(height: 8),
                StatsStrip(today: _c.today),
              ]),
            ),
          ),
        ),
        Positioned(
          left: 0, right: 0, bottom: 0,
          child: o != null
              ? OfferCard(offer: o, busy: _c.responding, onAccept: () => _c.respond(true), onDecline: () => _c.respond(false), onExpire: _c.expireOffer)
              : MapSheet(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  if (_c.error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_c.error!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontWeight: FontWeight.w600))),
                  if (_c.online) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text('Looking for ride requests near you…', style: Theme.of(context).textTheme.bodyLarge, textAlign: TextAlign.center)),
                  if (recs.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 12), child: CopilotChip(recommendation: recs.first, disclaimer: _c.copilot['disclaimer'] as String?)),
                  OnlineToggle(online: _c.online, busy: _c.busy, onToggle: _c.toggle),
                ])),
        ),
      ]);
    });
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.online, required this.hasOffer});
  final bool online;
  final bool hasOffer;
  @override
  Widget build(BuildContext context) {
    final color = online ? goGreen : const Color(0xFF94A3B8);
    final t = Theme.of(context);
    return Container(
      constraints: const BoxConstraints(minHeight: 60),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(color: t.colorScheme.surface.withValues(alpha: 0.94), borderRadius: BorderRadius.circular(18), border: Border.all(color: color.withValues(alpha: 0.6))),
      child: Row(children: [
        Icon(Icons.circle, size: 14, color: color),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(online ? 'You are online' : 'You are offline', style: t.textTheme.titleMedium),
          Text(hasOffer ? 'New ride request' : online ? 'Receiving requests' : 'Go online to get requests', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant)),
        ])),
        StatusPill(online ? 'ONLINE' : 'OFFLINE', color: color),
      ]),
    );
  }
}
