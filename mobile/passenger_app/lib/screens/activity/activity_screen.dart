import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../widgets/banner.dart';
import '../../widgets/ride_tile.dart';
import '../trip/trip_screen.dart';
import 'ride_detail_screen.dart';

const _filters = [('All', null), ('Active', 'ACTIVE'), ('Completed', 'COMPLETED'), ('Cancelled', 'CANCELLED')];
const _pageSize = 20;

/// Ride history with filter chips, pull to refresh and load more.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key, required this.api, required this.location});
  final ApiClient api;
  final DeviceLocation location;
  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  String? _filter;
  List<Json> _items = [];
  int _total = 0;
  bool _loading = true;
  bool _more = false;
  String? _error;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool append = false}) async {
    final my = ++_seq;
    final page = append ? _items.length ~/ _pageSize + 1 : 1;
    setState(() { if (append) { _more = true; } else if (_items.isEmpty) { _loading = true; } _error = null; });
    try {
      final r = await widget.api.get('/rides', query: {'pageSize': '$_pageSize', 'page': '$page', 'status': ?_filter});
      if (!mounted || my != _seq) return;
      final items = pageItems(r);
      setState(() { _items = append ? [..._items, ...items] : items; _total = r is Map ? ((r['total'] as num?)?.toInt() ?? _items.length) : _items.length; });
    } on ApiException catch (e) {
      if (mounted && my == _seq) setState(() => _error = isOffline(e) ? 'You appear to be offline. Pull down to retry.' : e.friendly);
    } finally {
      if (mounted && my == _seq) setState(() { _loading = false; _more = false; });
    }
  }

  void _open(Json r) {
    final active = const {'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'}.contains(r['status']);
    Navigator.push(context, MaterialPageRoute(builder: (_) => active ? TripScreen(api: widget.api, rideId: r['id'] as String, location: widget.location) : RideDetailScreen(api: widget.api, rideId: r['id'] as String, location: widget.location))).then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Activity')),
      body: Column(children: [
        SizedBox(
          height: 56,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), children: [
            for (final f in _filters) Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(f.$1), selected: _filter == f.$2, onSelected: (_) { _filter = f.$2; _items = []; _load(); })),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
              if (_loading) const SkeletonList(count: 5),
              if (_error != null && _items.isEmpty && !_loading) SizedBox(height: 360, child: ErrorState(message: _error!, onRetry: _load)),
              if (_error != null && _items.isNotEmpty) InlineBanner(_error!, action: 'Retry', onAction: _load),
              if (!_loading && _error == null && _items.isEmpty) SizedBox(height: 360, child: EmptyState(icon: Icons.history, title: _filter == null ? 'No rides yet' : 'Nothing here', message: _filter == null ? 'Your trips and receipts will appear here after your first ride.' : 'No ${_filters.firstWhere((f) => f.$2 == _filter).$1.toLowerCase()} rides.')),
              for (final r in _items) RideTile(ride: r, onTap: () => _open(r)),
              if (_items.length < _total) Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton(onPressed: _more ? null : () => _load(append: true), child: Text(_more ? 'Loading…' : 'Load more'))),
            ]),
          ),
        ),
      ]),
    );
  }
}
