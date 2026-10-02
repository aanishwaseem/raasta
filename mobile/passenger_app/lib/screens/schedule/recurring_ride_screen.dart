import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/place.dart';
import '../../widgets/banner.dart';
import '../../widgets/payment_picker.dart';
import '../../widgets/place_field.dart';
import '../../widgets/quote_picker.dart';
import '../../widgets/sheets.dart';

/// Repeat commute: choose days and a time. Auto-booking is off unless the rider switches it on.
class RecurringRideScreen extends StatefulWidget {
  const RecurringRideScreen({super.key, required this.api, this.pickup, this.dropoff});
  final ApiClient api;
  final Place? pickup;
  final Place? dropoff;
  @override
  State<RecurringRideScreen> createState() => _RecurringRideScreenState();
}

class _RecurringRideScreenState extends State<RecurringRideScreen> {
  final _label = TextEditingController(text: 'Commute');
  Place? _pickup;
  Place? _dropoff;
  String? _product;
  String _payment = 'CASH';
  final _days = <int>{1, 2, 3, 4, 5};
  bool _arriveBy = false;
  TimeOfDay _time = const TimeOfDay(hour: 8, minute: 15);
  bool _auto = false;
  PaymentInfo _info = const PaymentInfo();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _pickup = widget.pickup;
    _dropoff = widget.dropoff;
    PaymentInfo.load(widget.api).then((i) => mounted ? setState(() => _info = i) : null);
  }

  @override
  void dispose() {
    _label.dispose();
    super.dispose();
  }

  String get _hhmm => '${two(_time.hour)}:${two(_time.minute)}';

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/recurring-rides', body: {
        'label': _label.text.trim().isEmpty ? 'Commute' : _label.text.trim(),
        'pickup': _pickup!.toRequest(),
        'dropoff': _dropoff!.toRequest(),
        'productCode': _product,
        'paymentMethod': _payment,
        'daysOfWeek': _days.toList()..sort(),
        _arriveBy ? 'targetArrivalTime' : 'pickupTime': _hhmm,
        'autoDispatch': _auto,
      });
      if (!mounted) return;
      toast(context, _auto ? 'Commute saved. We will request your ride automatically.' : 'Commute saved. We will remind you to confirm each ride.');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = _pickup != null && _dropoff != null && _product != null && _days.isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: const Text('Recurring commute')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _label, maxLength: 60, decoration: const InputDecoration(labelText: 'Name', prefixIcon: Icon(Icons.repeat))),
        PlaceField(api: widget.api, label: 'Pickup', icon: Icons.trip_origin, initial: _pickup, onPicked: (p) => setState(() { _pickup = p; _product = null; })),
        const SizedBox(height: 8),
        PlaceField(api: widget.api, label: 'Where to?', icon: Icons.flag_outlined, iconColor: raastaAmber, initial: _dropoff, near: _pickup, onPicked: (p) => setState(() { _dropoff = p; _product = null; })),
        const SectionTitle('Days'),
        Wrap(spacing: 8, children: [
          for (var i = 1; i <= 7; i++) FilterChip(label: Text(weekdayShort[i - 1]), selected: _days.contains(i), onSelected: (s) => setState(() => s ? _days.add(i) : _days.remove(i))),
        ]),
        const SectionTitle('Time'),
        SegmentedButton<bool>(
          segments: const [ButtonSegment(value: false, label: Text('Pick me up at')), ButtonSegment(value: true, label: Text('Arrive by'))],
          selected: {_arriveBy},
          onSelectionChanged: (s) => setState(() => _arriveBy = s.first),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(onPressed: () async { final t = await showTimePicker(context: context, initialTime: _time); if (t != null) setState(() => _time = t); }, icon: const Icon(Icons.access_time), label: Text(clock(DateTime(2000, 1, 1, _time.hour, _time.minute)))),
        const Padding(padding: EdgeInsets.only(top: 6), child: Text('Times use Pakistan time.')),
        const SectionTitle('Ride type'),
        if (_pickup == null || _dropoff == null) const Text('Choose pickup and destination to see ride types.') else QuoteProductPicker(api: widget.api, pickup: _pickup!, dropoff: _dropoff!, selected: _product, onSelected: (c) => setState(() => _product = c)),
        const SectionTitle('Payment'),
        PaymentRow(method: _payment, info: _info, payable: null, onChanged: (v) => setState(() => _payment = v)),
        SwitchRow(
          title: 'Request automatically',
          subtitle: _auto ? 'Raasta will request this ride for you at the right time, without asking again.' : 'Off: we send a reminder and you tap to confirm each ride.',
          value: _auto,
          onChanged: (v) => setState(() => _auto = v),
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: InlineBanner(_error!, icon: Icons.error_outline)),
        const SizedBox(height: 12),
        FilledButton(onPressed: _busy || !ready ? null : _submit, child: Text(_busy ? 'Saving…' : 'Save commute')),
      ]),
    );
  }
}
