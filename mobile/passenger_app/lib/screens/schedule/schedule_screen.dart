import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/load_view.dart';
import '../../widgets/payment_picker.dart';
import '../../widgets/product_icon.dart';
import '../../widgets/sheets.dart';
import '../trip/trip_screen.dart';
import 'recurring_ride_screen.dart';
import 'schedule_ride_screen.dart';

/// Upcoming scheduled rides and recurring commutes. Lists and cancels both.
class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key, required this.api, required this.location});
  final ApiClient api;
  final DeviceLocation location;
  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> with SingleTickerProviderStateMixin {
  late final _tabs = TabController(length: 2, vsync: this);
  final _upcoming = GlobalKey<LoadViewState<List<Json>>>();
  final _recurring = GlobalKey<LoadViewState<List<Json>>>();

  @override
  void initState() {
    super.initState();
    _tabs.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final recurring = _tabs.index == 1;
    final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => recurring ? RecurringRideScreen(api: widget.api) : ScheduleRideScreen(api: widget.api, location: widget.location)));
    if (ok == true) (recurring ? _recurring : _upcoming).currentState?.reload();
  }

  Future<void> _cancel(Json s) async {
    if (!await confirmDialog(context, title: 'Cancel scheduled ride?', message: 'Your ride to ${shortAddress(asJson(s['dropoff'])['address'], parts: 1)} on ${whenText(s['pickupAt'])} will not be requested.', confirm: 'Cancel ride', cancel: 'Keep it', destructive: true)) return;
    try {
      await widget.api.delete('/scheduled-rides/${s['id']}');
      _upcoming.currentState?.reload();
      if (mounted) toast(context, 'Scheduled ride cancelled.');
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  Future<void> _confirmNow(Json s) async {
    try {
      final ride = asJson(await widget.api.post('/scheduled-rides/${s['id']}/confirm', body: {}));
      if (mounted && ride['id'] != null) Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, rideId: ride['id'] as String, location: widget.location)));
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  Future<void> _setAuto(Json r, bool v) async {
    try {
      await widget.api.patch('/recurring-rides/${r['id']}/auto-dispatch', body: {'autoDispatch': v});
      _recurring.currentState?.reload();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  Future<void> _deleteRecurring(Json r) async {
    if (!await confirmDialog(context, title: 'Delete this commute?', message: '"${r['label']}" and its upcoming rides will be cancelled.', confirm: 'Delete', cancel: 'Keep it', destructive: true)) return;
    try {
      await widget.api.delete('/recurring-rides/${r['id']}');
      _recurring.currentState?.reload();
      _upcoming.currentState?.reload();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scheduled rides'), bottom: TabBar(controller: _tabs, tabs: const [Tab(text: 'Upcoming'), Tab(text: 'Recurring')])),
      floatingActionButton: FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.add), label: Text(_tabs.index == 0 ? 'Schedule a ride' : 'New commute')),
      body: TabBarView(controller: _tabs, children: [
        LoadView<List<Json>>(
          key: _upcoming,
          load: () async => asJsonList(await widget.api.get('/scheduled-rides')),
          isEmpty: (l) => l.isEmpty,
          empty: const EmptyState(icon: Icons.event_available_outlined, title: 'No upcoming rides', message: 'Schedule a ride for an early flight or a meeting and we will have a driver ready.'),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
          builder: (c, list, _) => [for (final s in list) _upcomingCard(c, s)],
        ),
        LoadView<List<Json>>(
          key: _recurring,
          load: () async => asJsonList(await widget.api.get('/recurring-rides')),
          isEmpty: (l) => l.isEmpty,
          empty: const EmptyState(icon: Icons.repeat, title: 'No recurring commutes', message: 'Set up your daily commute once. We remind you, or book automatically if you allow it.'),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
          builder: (c, list, _) => [for (final r in list) _recurringCard(c, r)],
        ),
      ]),
    );
  }

  Widget _upcomingCard(BuildContext context, Json s) {
    final t = Theme.of(context);
    final needs = s['requiresConfirmation'] == true;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            CircleAvatar(backgroundColor: t.colorScheme.primary.withValues(alpha: 0.12), child: Icon(productIcon('${s['productCode']}'), color: t.colorScheme.primary)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(whenText(s['pickupAt']), style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
              Text('${shortAddress(asJson(s['pickup'])['address'], parts: 1)} → ${shortAddress(asJson(s['dropoff'])['address'], parts: 1)}', maxLines: 2, overflow: TextOverflow.ellipsis),
              Text('${humanize('${s['productCode']}')} · ${paymentName('${s['paymentMethod']}')}', style: t.textTheme.bodySmall),
            ])),
            if (s['recurringRideId'] != null) const StatusPill('Recurring'),
          ]),
          const SizedBox(height: 8),
          if (needs) Text('Reminder: confirm this ride when you are ready. It is not requested automatically.', style: t.textTheme.bodySmall?.copyWith(color: const Color(0xFF9A6200))),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            TextButton(onPressed: () => _cancel(s), child: const Text('Cancel')),
            if (needs) FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(120, 44)), onPressed: () => _confirmNow(s), child: const Text('Request now')),
          ]),
        ]),
      ),
    );
  }

  Widget _recurringCard(BuildContext context, Json r) {
    final t = Theme.of(context);
    final days = (r['daysOfWeek'] as List? ?? const []).map((e) => weekdayShort[((e as num).toInt() - 1).clamp(0, 6)]).join(', ');
    final time = r['pickupTime'] != null ? 'Pickup ${r['pickupTime']}' : 'Arrive by ${r['targetArrivalTime']}';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${r['label']}', style: t.textTheme.titleMedium)),
            IconButton(tooltip: 'Delete commute', onPressed: () => _deleteRecurring(r), icon: const Icon(Icons.delete_outline)),
          ]),
          Text('${shortAddress(r['pickupAddress'], parts: 1)} → ${shortAddress(r['dropoffAddress'], parts: 1)}'),
          Text('$days · $time', style: t.textTheme.bodySmall),
          SwitchRow(title: 'Request automatically', subtitle: r['autoDispatch'] == true ? 'On: booked for you without asking.' : 'Off: you confirm each ride from a reminder.', value: r['autoDispatch'] == true, onChanged: (v) => _setAuto(r, v)),
        ]),
      ),
    );
  }
}
