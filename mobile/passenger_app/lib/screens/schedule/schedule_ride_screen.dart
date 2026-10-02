import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../util/place.dart';
import '../../widgets/banner.dart';
import '../../widgets/payment_picker.dart';
import '../../widgets/place_field.dart';
import '../../widgets/quote_picker.dart';

/// Book a ride for later: either a pickup time or "be there by" a time.
/// Rides are only requested at the time you chose; nothing is requested now.
class ScheduleRideScreen extends StatefulWidget {
  const ScheduleRideScreen({super.key, required this.api, this.pickup, this.dropoff, this.productCode, this.location});
  final ApiClient api;
  final Place? pickup;
  final Place? dropoff;
  final String? productCode;
  final DeviceLocation? location;

  @override
  State<ScheduleRideScreen> createState() => _ScheduleRideScreenState();
}

class _ScheduleRideScreenState extends State<ScheduleRideScreen> {
  Place? _pickup;
  Place? _dropoff;
  String? _product;
  String _payment = 'CASH';
  bool _arriveBy = false;
  DateTime _when = DateTime.now().add(const Duration(hours: 2));
  PaymentInfo _info = const PaymentInfo();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _pickup = widget.pickup;
    _dropoff = widget.dropoff;
    _product = widget.productCode;
    PaymentInfo.load(widget.api).then((i) => mounted ? setState(() => _info = i) : null);
    if (_pickup == null && widget.location != null) {
      widget.location!.current().then((f) => mounted && _pickup == null ? setState(() => _pickup = Place(f.approximate ? 'City centre' : 'Current location', f.approximate ? 'City centre' : 'Current location', f.lat, f.lng)) : null);
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _when, firstDate: now, lastDate: now.add(const Duration(days: 30)));
    if (d != null) setState(() => _when = DateTime(d.year, d.month, d.day, _when.hour, _when.minute));
  }

  Future<void> _pickTime() async {
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_when));
    if (t != null) setState(() => _when = DateTime(_when.year, _when.month, _when.day, t.hour, t.minute));
  }

  Future<void> _submit() async {
    if (_pickup == null || _dropoff == null || _product == null) return;
    if (_when.isBefore(DateTime.now().add(const Duration(minutes: 15)))) {
      setState(() => _error = 'Pick a time at least 15 minutes from now. For sooner trips, request a ride now.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      final r = asJson(await widget.api.post('/scheduled-rides', body: {
        'pickup': _pickup!.toRequest(),
        'dropoff': _dropoff!.toRequest(),
        'productCode': _product,
        'paymentMethod': _payment,
        _arriveBy ? 'targetArrivalAt' : 'pickupAt': _when.toUtc().toIso8601String(),
      }));
      if (!mounted) return;
      final fare = asJson(r['estimate'])['fare'];
      toast(context, 'Ride scheduled for ${whenText(r['pickupAt'])}${fare is num ? '. Estimated fare ${money(fare)}' : ''}.');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = _pickup != null && _dropoff != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Schedule a ride')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        PlaceField(api: widget.api, label: 'Pickup', icon: Icons.trip_origin, initial: _pickup, near: _pickup, onPicked: (p) => setState(() { _pickup = p; _product = null; })),
        const SizedBox(height: 8),
        PlaceField(api: widget.api, label: 'Where to?', icon: Icons.flag_outlined, iconColor: raastaAmber, initial: _dropoff, near: _pickup, onPicked: (p) => setState(() { _dropoff = p; _product = null; })),
        const SectionTitle('When'),
        SegmentedButton<bool>(
          segments: const [ButtonSegment(value: false, label: Text('Pick me up at'), icon: Icon(Icons.schedule)), ButtonSegment(value: true, label: Text('Arrive by'), icon: Icon(Icons.flag_circle_outlined))],
          selected: {_arriveBy},
          onSelectionChanged: (s) => setState(() => _arriveBy = s.first),
        ),
        if (_arriveBy) const Padding(padding: EdgeInsets.only(top: 8), child: Text('We work out when to pick you up from the predicted trip time, with a safety buffer.')),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: _pickDate, icon: const Icon(Icons.calendar_today_outlined), label: Text(dayLabel(_when)))),
          const SizedBox(width: 8),
          Expanded(child: OutlinedButton.icon(onPressed: _pickTime, icon: const Icon(Icons.access_time), label: Text(clock(_when)))),
        ]),
        const SectionTitle('Ride type'),
        if (!ready) const Text('Choose pickup and destination to see ride types and fare estimates.') else QuoteProductPicker(api: widget.api, pickup: _pickup!, dropoff: _dropoff!, selected: _product, onSelected: (c) => setState(() => _product = c)),
        const SectionTitle('Payment'),
        PaymentRow(method: _payment, info: _info, payable: null, onChanged: (v) => setState(() => _payment = v)),
        const Text('Fares are estimates. The final price is confirmed when the ride is requested.'),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: InlineBanner(_error!, icon: Icons.error_outline)),
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy || !ready || _product == null ? null : _submit, child: Text(_busy ? 'Scheduling…' : 'Schedule ride')),
      ]),
    );
  }
}
