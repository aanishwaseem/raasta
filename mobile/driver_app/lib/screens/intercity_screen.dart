import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import '../widgets/intercity_form.dart';

/// Intercity trips the driver has posted: list, post a new one, cancel an open one.
class IntercityScreen extends StatefulWidget {
  const IntercityScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<IntercityScreen> createState() => _IntercityScreenState();
}

class _IntercityScreenState extends State<IntercityScreen> {
  Key _reload = UniqueKey();

  Future<List<Map<String, dynamic>>> _load() async => asList(await widget.api.get('/driver/intercity/trips'));

  Future<void> _post() async {
    try {
      final routes = asList(await widget.api.get('/intercity/routes'));
      if (!mounted) return;
      if (routes.isEmpty) {
        toast(context, 'No intercity routes are available yet.');
        return;
      }
      final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => IntercityForm(api: widget.api, routes: routes));
      if (ok == true && mounted) {
        toast(context, 'Trip posted. Riders can now book seats.');
        setState(() => _reload = UniqueKey());
      }
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    }
  }

  Future<void> _cancel(Map<String, dynamic> trip) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Cancel this trip?'),
        content: Text(dbl(trip['seatsBooked']) > 0 ? '${trip['seatsBooked']} booked seat(s) will be cancelled and riders notified.' : 'No seats are booked yet.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep trip')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Cancel trip'))],
      ),
    );
    if (sure != true) return;
    try {
      await widget.api.delete('/driver/intercity/trips/${trip['id']}');
      if (mounted) {
        toast(context, 'Trip cancelled.');
        setState(() => _reload = UniqueKey());
      }
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Intercity trips')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _post, icon: const Icon(Icons.add), label: const Text('Post trip')),
      body: AsyncBody<List<Map<String, dynamic>>>(
        key: _reload,
        load: _load,
        isEmpty: (l) => l.isEmpty,
        empty: EmptyState(icon: Icons.alt_route, title: 'No intercity trips yet', message: 'Post a trip between cities and riders can book seats.', action: 'Post a trip', onAction: _post),
        builder: (context, trips, refresh) => RefreshIndicator(
          onRefresh: refresh,
          child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
            for (final t in trips)
              Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(
                icon: Icons.alt_route,
                title: '${t['pickupPoint']} to ${t['dropoffPoint']}',
                subtitle: '${when(t['departureAt']) == null ? '' : '${dayLabel(when(t['departureAt'])!)} ${clock(when(t['departureAt'])!)} · '}${t['seatsBooked'] ?? 0}/${t['seatsTotal']} seats · ${money(dbl(t['seatFare']))} each',
                trailing: ['OPEN', 'FULL'].contains(t['status']) ? Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [StatusPill(prettyStatus('${t['status']}')), TextButton(style: TextButton.styleFrom(minimumSize: const Size(64, 48), foregroundColor: sosRed), onPressed: () => _cancel(t), child: const Text('Cancel'))]) : StatusPill(prettyStatus('${t['status']}'), color: t['status'] == 'CANCELLED' ? sosRed : null),
              )),
          ]),
        ),
      ),
    );
  }
}
