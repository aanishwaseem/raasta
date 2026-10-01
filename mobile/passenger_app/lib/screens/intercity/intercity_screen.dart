import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/banner.dart';
import '../../widgets/load_view.dart';
import '../../widgets/sheets.dart';
import 'book_seats_sheet.dart';

/// Shared seats between cities: browse routes and trips, book seats, see and cancel bookings.
class IntercityScreen extends StatefulWidget {
  const IntercityScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<IntercityScreen> createState() => _IntercityScreenState();
}

class _IntercityScreenState extends State<IntercityScreen> with SingleTickerProviderStateMixin {
  late final _tabs = TabController(length: 2, vsync: this);
  final _bookings = GlobalKey<LoadViewState<List<Json>>>();
  final _find = GlobalKey<LoadViewState<List<Json>>>();
  String? _routeId;
  List<Json> _trips = [];
  bool _loadingTrips = false;
  String? _tripsError;

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _loadTrips(String routeId) async {
    setState(() { _routeId = routeId; _loadingTrips = true; _tripsError = null; });
    try {
      final t = asJsonList(await widget.api.get('/intercity/trips', query: {'routeId': routeId}));
      if (mounted && _routeId == routeId) setState(() { _trips = t; _loadingTrips = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _tripsError = e.friendly; _loadingTrips = false; });
    }
  }

  Future<void> _book(Json trip) async {
    final r = await showBookSeats(context, widget.api, trip);
    if (r == null || !mounted) return;
    toast(context, 'Booked ${r['seats']} seat${r['seats'] == 1 ? '' : 's'} for ${money(r['total'] as num?)}. ${r['paymentNote'] ?? ''}');
    _bookings.currentState?.reload();
    if (_routeId != null) _loadTrips(_routeId!);
    _tabs.animateTo(1);
  }

  Future<void> _cancel(Json b) async {
    if (!await confirmDialog(context, title: 'Cancel booking?', message: 'Your ${b['seats']} seat${b['seats'] == 1 ? '' : 's'} on ${whenText(b['departureAt'])} will be released. Free up to 2 hours before departure.', confirm: 'Cancel booking', cancel: 'Keep it', destructive: true)) return;
    try {
      await widget.api.delete('/intercity/bookings/${b['id']}');
      _bookings.currentState?.reload();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Intercity seats'), bottom: TabBar(controller: _tabs, tabs: const [Tab(text: 'Find a seat'), Tab(text: 'My bookings')])),
      body: TabBarView(controller: _tabs, children: [
        LoadView<List<Json>>(
          key: _find,
          load: () async => asJsonList(await widget.api.get('/intercity/routes')),
          isEmpty: (r) => r.isEmpty,
          empty: const EmptyState(icon: Icons.alt_route, title: 'No intercity routes yet', message: 'Routes between cities will appear here when drivers offer them.'),
          builder: (context, routes, _) => [
            Text('Share a car between cities and pay per seat. Choose a route.', style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 8),
            for (final r in routes)
              InfoTile(
                icon: Icons.alt_route,
                title: '${r['origin']} → ${r['destination']}',
                subtitle: '${r['distanceKm']} km · about ${((r['typicalDurationMin'] as num?) ?? 0) ~/ 60}h ${((r['typicalDurationMin'] as num?) ?? 0) % 60}m · from ${money(r['suggestedSeatFare'] as num?)} per seat',
                color: r['id'] == _routeId ? raastaAmber : null,
                trailing: Icon(r['id'] == _routeId ? Icons.expand_less : Icons.expand_more),
                onTap: () => _loadTrips(r['id'] as String),
              ),
            if (_routeId != null) ...[
              const SectionTitle('Departures'),
              if (_tripsError != null) InlineBanner(_tripsError!, action: 'Retry', onAction: () => _loadTrips(_routeId!)),
              if (_loadingTrips) const SkeletonList(count: 2, height: 110),
              if (!_loadingTrips && _tripsError == null && _trips.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No departures on this route yet. Check back soon.')),
              for (final t in _trips) _tripCard(context, t),
            ],
          ],
        ),
        LoadView<List<Json>>(
          key: _bookings,
          load: () async => asJsonList(await widget.api.get('/intercity/bookings')),
          isEmpty: (l) => l.isEmpty,
          empty: const EmptyState(icon: Icons.airline_seat_recline_normal, title: 'No bookings yet', message: 'Seats you book will show up here.'),
          builder: (context, list, _) => [for (final b in list) _bookingCard(context, b)],
        ),
      ]),
    );
  }

  Widget _tripCard(BuildContext context, Json trip) {
    final t = Theme.of(context);
    final left = (trip['seatsLeft'] as num?)?.toInt() ?? 0;
    final car = [trip['color'], trip['make'], trip['model']].where((e) => e != null).join(' ');
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Expanded(child: Text(whenText(trip['departureAt']), style: t.textTheme.titleMedium)), Text('${money(trip['seatFare'] as num?)} / seat', style: t.textTheme.titleSmall)]),
          Text('${trip['pickupPoint']} → ${trip['dropoffPoint']}'),
          const SizedBox(height: 4),
          Text('${trip['driverFirstName'] ?? 'Driver'}${trip['ratingAvg'] is num ? ' · ${(trip['ratingAvg'] as num).toStringAsFixed(1)} ★' : ''} · $car', style: t.textTheme.bodySmall),
          Text('${luggageLabels[trip['luggagePolicy']] ?? ''} · $left seat${left == 1 ? '' : 's'} left', style: t.textTheme.bodySmall),
          const SizedBox(height: 8),
          FilledButton(onPressed: left > 0 ? () => _book(trip) : null, child: Text(left > 0 ? 'Book seats' : 'Full')),
        ]),
      ),
    );
  }

  Widget _bookingCard(BuildContext context, Json b) {
    final confirmed = b['status'] == 'CONFIRMED';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Expanded(child: Text(whenText(b['departureAt']), style: Theme.of(context).textTheme.titleMedium)), StatusPill(humanize('${b['status']}'), color: confirmed ? Colors.green.shade700 : Theme.of(context).colorScheme.error)]),
          Text('${b['pickupPoint']} → ${b['dropoffPoint']}'),
          Text('${b['seats']} seat${b['seats'] == 1 ? '' : 's'} · ${money(b['fareTotal'] as num?)} cash to ${b['driverFirstName'] ?? 'the driver'}', style: Theme.of(context).textTheme.bodySmall),
          if (confirmed) Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => _cancel(b), child: const Text('Cancel booking'))),
        ]),
      ),
    );
  }
}
