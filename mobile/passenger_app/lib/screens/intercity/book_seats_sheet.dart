import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/sheets.dart';

const luggageLabels = {'NONE': 'No luggage', 'ONE_BAG': '1 bag per seat', 'TWO_BAGS': '2 bags per seat', 'LARGE_ALLOWED': 'Large luggage allowed'};
const _maxBags = {'NONE': 0, 'ONE_BAG': 1, 'TWO_BAGS': 2, 'LARGE_ALLOWED': 4};

/// Seat and luggage picker. Pops the booking response, or null.
Future<Json?> showBookSeats(BuildContext context, ApiClient api, Json trip) => showAppSheet<Json>(context, (c) => BookSeatsSheet(api: api, trip: trip));

class BookSeatsSheet extends StatefulWidget {
  const BookSeatsSheet({super.key, required this.api, required this.trip});
  final ApiClient api;
  final Json trip;
  @override
  State<BookSeatsSheet> createState() => _BookSeatsSheetState();
}

class _BookSeatsSheetState extends State<BookSeatsSheet> {
  int _seats = 1;
  int _bags = 0;
  bool _busy = false;
  String? _error;
  final _key = ApiClient.newIdempotencyKey();

  Future<void> _book() async {
    setState(() { _busy = true; _error = null; });
    try {
      final r = asJson(await widget.api.post('/intercity/trips/${widget.trip['id']}/book', idempotencyKey: _key, body: {'seats': _seats, if (_bags > 0) 'luggageCount': _bags}));
      if (mounted) Navigator.pop(context, r);
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final left = (widget.trip['seatsLeft'] as num?)?.toInt() ?? 1;
    final policy = (widget.trip['luggagePolicy'] ?? 'ONE_BAG').toString();
    final maxBags = (_maxBags[policy] ?? 1) * _seats;
    final fare = dbl(widget.trip['seatFare']);
    Widget stepper(String label, int v, int min, int max, ValueChanged<int> on) => Row(children: [
          Expanded(child: Text(label, style: t.textTheme.titleSmall)),
          IconButton.outlined(tooltip: 'Decrease $label', onPressed: v > min ? () => on(v - 1) : null, icon: const Icon(Icons.remove)),
          SizedBox(width: 40, child: Text('$v', textAlign: TextAlign.center, style: t.textTheme.titleMedium)),
          IconButton.outlined(tooltip: 'Increase $label', onPressed: v < max ? () => on(v + 1) : null, icon: const Icon(Icons.add)),
        ]);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SheetTitle('Book seats', subtitle: '${shortAddress(widget.trip['pickupPoint'], parts: 1)} → ${shortAddress(widget.trip['dropoffPoint'], parts: 1)} · ${whenText(widget.trip['departureAt'])}'),
      stepper('Seats', _seats, 1, left.clamp(1, 6), (v) => setState(() { _seats = v; if (_bags > (_maxBags[policy] ?? 1) * v) _bags = (_maxBags[policy] ?? 1) * v; })),
      if (maxBags > 0) stepper('Bags', _bags, 0, maxBags, (v) => setState(() => _bags = v)) else Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text('This driver does not take luggage.', style: t.textTheme.bodySmall)),
      const Divider(height: 24),
      Row(children: [Expanded(child: Text('Total', style: t.textTheme.titleMedium)), Text(money(fare * _seats), style: t.textTheme.titleLarge)]),
      const SizedBox(height: 4),
      Text('Pay the driver in cash at pickup. You can cancel up to 2 hours before departure.', style: t.textTheme.bodySmall),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: t.colorScheme.error))),
      const SizedBox(height: 16),
      FilledButton(onPressed: _busy ? null : _book, child: Text(_busy ? 'Booking…' : 'Confirm booking')),
    ]);
  }
}
