import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import '../widgets/copilot_chip.dart';
import '../widgets/driver_map.dart';

const _radius = {'HIGH': 900.0, 'MEDIUM': 700.0, 'LOW': 500.0};
const _rank = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2};

/// Demand intelligence: predicted demand zones on a map and in a list, plus copilot suggestions.
/// Everything here is a prediction for the next hour, never a guarantee.
class DemandScreen extends StatefulWidget {
  const DemandScreen({super.key, required this.api, required this.location});
  final ApiClient api;
  final DeviceLocation location;

  @override
  State<DemandScreen> createState() => _DemandScreenState();
}

class _DemandScreenState extends State<DemandScreen> {
  Future<Map<String, dynamic>> _load() async {
    final results = await Future.wait<dynamic>([
      widget.api.get('/driver/demand'),
      widget.api.get('/driver/copilot').then<dynamic>((v) => v, onError: (_) => null),
      widget.location.current(),
    ]);
    return {'demand': asMap(results[0]), 'copilot': asMap(results[1]), 'fix': results[2]};
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Demand')),
      body: AsyncBody<Map<String, dynamic>>(load: _load, builder: (context, data, refresh) {
        final demand = asMap(data['demand']);
        final fix = data['fix'] as Fix;
        final zones = asList(demand['zones']);
        if (zones.isEmpty) return RefreshIndicator(onRefresh: refresh, child: ListView(children: const [SizedBox(height: 120), EmptyState(icon: Icons.map_outlined, title: 'No demand data yet', message: 'Predictions appear here when there is enough recent activity in your city. Pull down to refresh.')]));
        final me = fix.approximate ? null : LatLng(fix.lat, fix.lng);
        double? dist(Map<String, dynamic> z) => me == null ? null : distanceM(me.latitude, me.longitude, dbl(asMap(z['centroid'])['lat']), dbl(asMap(z['centroid'])['lng']));
        final sorted = [...zones]..sort((a, b) {
            final r = (_rank[a['level']] ?? 3).compareTo(_rank[b['level']] ?? 3);
            return r != 0 ? r : (dist(a) ?? 0).compareTo(dist(b) ?? 0);
          });
        final center = me ?? LatLng(dbl(asMap(zones.first['centroid'])['lat']), dbl(asMap(zones.first['centroid'])['lng']));
        final recs = asList(asMap(data['copilot'])['recommendations']);
        return RefreshIndicator(
          onRefresh: refresh,
          child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: SizedBox(height: 280, child: DriverMap(center: center, follow: false, zoom: 12, fitKey: '${zones.length}', fitPadding: const EdgeInsets.all(40), circles: [for (final z in zones) MapCircle(dbl(asMap(z['centroid'])['lat']), dbl(asMap(z['centroid'])['lng']), _radius[z['level']] ?? 500, demandColor('${z['level']}'))])),
            ),
            const SizedBox(height: 8),
            const Wrap(spacing: 12, children: [_Key('HIGH'), _Key('MEDIUM'), _Key('LOW')]),
            const SizedBox(height: 4),
            Text('${demand['disclaimer'] ?? 'Demand levels are predictions for the next hour, not guarantees.'}', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: raastaAmber)),
            const SectionTitle('Copilot suggestions'),
            _Outside(zones: sorted, distance: dist),
            for (final r in recs) Padding(padding: const EdgeInsets.only(top: 8), child: CopilotChip(recommendation: r, disclaimer: '${asMap(data['copilot'])['disclaimer'] ?? ''}')),
            const SectionTitle('Zones'),
            for (final z in sorted) Padding(padding: const EdgeInsets.only(bottom: 8), child: _ZoneTile(zone: z, distanceM: dist(z))),
          ]),
        );
      }),
    );
  }
}

class _Key extends StatelessWidget {
  const _Key(this.level);
  final String level;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.circle, size: 14, color: demandColor(level)), const SizedBox(width: 6), Text('${demandLabel(level)} demand')]);
}

/// "You are X km outside a high demand area", phrased as a prediction.
class _Outside extends StatelessWidget {
  const _Outside({required this.zones, required this.distance});
  final List<Map<String, dynamic>> zones;
  final double? Function(Map<String, dynamic>) distance;

  @override
  Widget build(BuildContext context) {
    final high = zones.where((z) => z['level'] == 'HIGH' && distance(z) != null).toList()..sort((a, b) => distance(a)!.compareTo(distance(b)!));
    if (high.isEmpty) {
      return InfoTile(icon: Icons.auto_awesome, title: zones.any((z) => z['level'] == 'HIGH') ? 'Turn on location for distances' : 'No high-demand area predicted right now', subtitle: 'Predictions update through the day. They are not guarantees.');
    }
    final z = high.first;
    final out = distance(z)! - _radius['HIGH']!;
    final text = out <= 0 ? 'You are inside the ${z['name']} area, where demand is predicted to be high.' : 'You are about ${(out / 1000).toStringAsFixed(1)} km outside ${z['name']}, where demand is predicted to be high in the next hour.';
    return InfoTile(icon: Icons.auto_awesome, color: demandHigh, title: 'Copilot prediction', subtitle: '$text This is an estimate, not a promise of rides.');
  }
}

class _ZoneTile extends StatelessWidget {
  const _ZoneTile({required this.zone, required this.distanceM});
  final Map<String, dynamic> zone;
  final double? distanceM;
  @override
  Widget build(BuildContext context) {
    final level = '${zone['level']}';
    final parts = ['~${dbl(zone['expectedRequests']).toStringAsFixed(0)} requests expected', '${zone['onlineDrivers'] ?? 0} drivers nearby', if (distanceM != null) '${km(distanceM)} away'];
    return InfoTile(icon: Icons.local_fire_department, color: demandColor(level), title: '${zone['name']}', subtitle: parts.join(' · '), trailing: StatusPill(demandLabel(level), color: demandColor(level)));
  }
}
