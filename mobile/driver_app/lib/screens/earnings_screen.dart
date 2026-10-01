import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import '../widgets/bar_chart.dart';
import '../widgets/metric_tile.dart';

enum EarningsPeriod { today, week, month }

/// Earnings analytics for today / 7 days / 30 days from GET /driver/earnings. Estimates are labelled as such.
class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen> {
  EarningsPeriod _period = EarningsPeriod.today;

  Future<Map<String, dynamic>> _load() async {
    final now = DateTime.now();
    final from = switch (_period) {
      EarningsPeriod.today => DateTime(now.year, now.month, now.day),
      EarningsPeriod.week => now.subtract(const Duration(days: 7)),
      EarningsPeriod.month => now.subtract(const Duration(days: 30)),
    };
    return asMap(await widget.api.get('/driver/earnings', query: {'from': from.toUtc().toIso8601String(), 'to': now.toUtc().toIso8601String()}));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Earnings')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: SegmentedButton<EarningsPeriod>(
            showSelectedIcon: false,
            style: SegmentedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            segments: const [ButtonSegment(value: EarningsPeriod.today, label: Text('Today')), ButtonSegment(value: EarningsPeriod.week, label: Text('7 days')), ButtonSegment(value: EarningsPeriod.month, label: Text('30 days'))],
            selected: {_period},
            onSelectionChanged: (s) => setState(() => _period = s.first),
          ),
        ),
        Expanded(
          child: AsyncBody<Map<String, dynamic>>(
            key: ValueKey(_period),
            load: _load,
            builder: (context, e, refresh) => RefreshIndicator(onRefresh: refresh, child: _Body(e: e, period: _period)),
          ),
        ),
      ]),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.e, required this.period});
  final Map<String, dynamic> e;
  final EarningsPeriod period;

  String _h(dynamic v) => v == null ? '–' : '${dbl(v).toStringAsFixed(1)} h';

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final daily = asList(e['daily']);
    final busy = dbl(e['busyHours']), idle = dbl(e['idleHours']);
    final rates = [('Acceptance', 'acceptanceRate'), ('Completion', 'completionRate'), ('Cancellation', 'cancellationRate')].where((r) => e[r.$2] is num).toList();
    Widget grid(List<Widget> tiles) => GridView(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: 8, crossAxisSpacing: 8, mainAxisExtent: 112), children: tiles);
    return ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
      Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Take-home after fuel estimate', style: t.textTheme.labelLarge?.copyWith(color: t.colorScheme.onSurfaceVariant)),
        Text(money(dbl(e['netAfterFuelEstimate'], dbl(e['net']))), style: t.textTheme.displayMedium?.copyWith(fontWeight: FontWeight.w900, color: goGreen)),
        Text('${e['trips'] ?? 0} trips · ${dbl(e['distanceKm']).toStringAsFixed(1)} km driven', style: t.textTheme.bodyMedium),
      ]))),
      const SectionTitle('Breakdown'),
      grid([
        MetricTile(icon: Icons.payments, label: 'Gross fares', value: money(dbl(e['gross']))),
        MetricTile(icon: Icons.percent, label: 'Platform fees', value: '– ${money(dbl(e['platformFees']))}'),
        MetricTile(icon: Icons.local_gas_station, label: 'Fuel (estimate)', value: '– ${money(dbl(e['fuelEstimate']))}', hint: 'Estimate only'),
        MetricTile(icon: Icons.account_balance_wallet, label: 'Net before fuel', value: money(dbl(e['net'])), hint: dbl(e['cancellationFeesEarned']) > 0 ? 'incl. cancel fees' : null),
      ]),
      const SectionTitle('Efficiency'),
      grid([
        MetricTile(icon: Icons.speed, label: 'Earnings per hour', value: e['perHour'] == null ? '–' : money(dbl(e['perHour']))),
        MetricTile(icon: Icons.add_road, label: 'Earnings per km', value: e['perKm'] == null ? '–' : money(dbl(e['perKm']))),
        MetricTile(icon: Icons.hourglass_empty, label: 'Idle time', value: _h(e['idleHours'])),
        MetricTile(icon: Icons.timer, label: 'Online hours', value: _h(e['onlineHours'])),
      ]),
      const SectionTitle('Time online'),
      Card(child: Padding(padding: const EdgeInsets.all(16), child: SplitBar(parts: [(label: 'With riders', value: busy, color: goGreen), (label: 'Idle', value: idle, color: raastaAmber)]))),
      const SectionTitle('Daily net earnings'),
      Card(child: Padding(
        padding: const EdgeInsets.all(16),
        child: daily.length >= 2
            ? BarChart(values: [for (final d in daily) dbl(d['net'])], labels: [for (final d in daily) dayLabel(DateTime.tryParse('${d['date']}') ?? DateTime.now())])
            : Text(period == EarningsPeriod.today ? 'The daily chart appears for 7 and 30 day views.' : 'Not enough days with trips yet to draw a chart.', style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.onSurfaceVariant)),
      )),
      if (daily.length >= 2) ...[
        const SectionTitle('Trips per day'),
        Card(child: Padding(padding: const EdgeInsets.all(16), child: BarChart(height: 100, color: raastaAmber, values: [for (final d in daily) dbl(d['trips'])], labels: [for (final d in daily) dayLabel(DateTime.tryParse('${d['date']}') ?? DateTime.now())]))),
      ],
      const SectionTitle('Reliability rates'),
      if (rates.isEmpty)
        const InfoTile(icon: Icons.insights, title: 'Rates not available yet', subtitle: 'Acceptance, completion and cancellation rates will show here when the server provides them.')
      else
        grid([for (final r in rates) MetricTile(icon: Icons.verified, label: r.$1, value: '${(dbl(e[r.$2]) * (dbl(e[r.$2]) <= 1 ? 100 : 1)).round()}%')]),
      for (final n in (e['notes'] as List? ?? const [])) Padding(padding: const EdgeInsets.only(top: 12), child: Text('$n', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant))),
    ]);
  }
}
