import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../util/place.dart';
import '../../widgets/banner.dart';
import '../../widgets/fare_explain.dart';
import '../../widgets/full_bleed_map.dart';
import '../../widgets/option_card.dart';
import '../../widgets/payment_picker.dart';
import '../schedule/schedule_ride_screen.dart';
import '../trip/trip_screen.dart';
import 'booking_panels.dart';

/// Pickup, destination, ride options, payment and request, laid over a map as a bottom sheet.
class BookingScreen extends StatefulWidget {
  const BookingScreen({super.key, required this.api, required this.location, this.pickup, this.dropoff, this.productCode, this.note});
  final ApiClient api;
  final DeviceLocation location;
  final Place? pickup;
  final Place? dropoff;

  /// Ride type to preselect (from a suggestion). The rider still has to tap request.
  final String? productCode;
  final String? note;

  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends State<BookingScreen> {
  Place? _pickup;
  Place? _dropoff;
  List<Place> _saved = [];
  Json? _quote;
  String? _product;
  String _payment = 'CASH';
  PaymentInfo _info = const PaymentInfo();
  int? _offer;
  int _seats = 1;
  bool _safety = false;
  bool _editing = true;
  bool _busy = false;
  bool _quoting = false;
  String? _error;
  String? _promoMsg;
  bool _promoOk = false;
  String? _requestKey;
  final _promo = TextEditingController();

  @override
  void initState() {
    super.initState();
    _pickup = widget.pickup;
    _dropoff = widget.dropoff;
    _editing = _dropoff == null;
    _loadSideData();
    if (_pickup == null) _locate();
    if (_pickup != null && _dropoff != null) _getQuote(preselect: widget.productCode);
  }

  Future<void> _loadSideData() async {
    PaymentInfo.load(widget.api).then((i) => mounted ? setState(() => _info = i) : null);
    try {
      final p = asJsonList(await widget.api.get('/me/places')).map(Place.fromJson).toList();
      if (mounted) setState(() => _saved = p);
    } on ApiException {/* shortcuts are optional */}
  }

  Future<void> _locate() async {
    final f = await widget.location.current();
    if (!mounted || _pickup != null) return;
    setState(() => _pickup = Place(f.approximate ? 'City centre' : 'Current location', f.approximate ? 'City centre' : 'Current location', f.lat, f.lng));
  }

  Future<void> _getQuote({String? preselect}) async {
    if (_pickup == null || _dropoff == null) return;
    final code = _promo.text.trim().toUpperCase();
    setState(() { _quoting = true; _error = null; _quote = null; _requestKey = null; _offer = null; _editing = false; });
    try {
      final q = asJson(await widget.api.post('/rides/quotes', body: {'pickup': _pickup!.toRequest(), 'dropoff': _dropoff!.toRequest(), if (code.isNotEmpty) 'promoCode': code}));
      final opts = asJsonList(q['options']);
      if (!mounted) return;
      setState(() {
        _quote = q;
        _product = opts.any((o) => o['productCode'] == (preselect ?? _product)) ? (preselect ?? _product) : (opts.isEmpty ? null : opts.firstWhere((o) => o['availability'] != 'NONE', orElse: () => opts.first)['productCode'] as String);
        _promoOk = q['promo'] != null;
        _promoMsg = q['promoError'] != null ? q['promoError'].toString() : (_promoOk ? '${asJson(q['promo'])['description'] ?? 'Promo applied'}' : null);
        _seats = 1;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.friendly; _editing = true; });
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  Json? get _option => asJsonList(_quote?['options']).where((o) => o['productCode'] == _product).firstOrNull;

  Future<void> _request() async {
    final o = _option, q = _quote;
    if (o == null || q == null) return;
    final fare = asJson(o['fare']);
    final rec = dbl(fare['recommended']).round();
    final offer = _offer ?? rec;
    setState(() { _busy = true; _error = null; });
    // Same key for retries of this tap, so a flaky connection can't create two rides.
    _requestKey ??= ApiClient.newIdempotencyKey();
    try {
      final ride = asJson(await widget.api.post('/rides', idempotencyKey: _requestKey, body: {
        'quoteId': q['id'],
        'productCode': _product,
        'paymentMethod': _payment,
        if (offer != rec) 'offeredFare': offer,
        if (q['promo'] != null) 'promoCode': _promo.text.trim().toUpperCase(),
        if (_safety) 'safetyMode': true,
        if (o['isShared'] == true && _seats > 1) 'seats': _seats,
      }));
      _requestKey = null;
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, rideId: ride['id'] as String, location: widget.location)));
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'QUOTE_EXPIRED') {
        await _getQuote();
        if (mounted) setState(() => _error = 'Prices were refreshed. Please review the fare and request again.');
      } else if (e.code == 'ACTIVE_RIDE_EXISTS') {
        setState(() => _error = 'You already have a ride in progress.');
        _openActive();
      } else {
        setState(() { _error = e.friendly; if (e.status < 500) _requestKey = null; });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openActive() async {
    try {
      final a = asJson(await widget.api.get('/rides/active'));
      if (a['id'] != null && mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, rideId: a['id'] as String, location: widget.location)));
    } on ApiException {/* banner already explains */}
  }

  @override
  void dispose() {
    _promo.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final route = [for (final r in (_quote?['route'] as List? ?? const [])) [dbl((r as List)[0]), dbl(r[1])]];
    return Scaffold(
      body: Stack(fit: StackFit.expand, children: [
        Positioned(
          left: 0, right: 0, top: 0, bottom: size.height * 0.28,
          child: _pickup == null
              ? const Center(child: CircularProgressIndicator())
              : FullBleedMap(route: route, pins: [
                  MapPin(_pickup!.lat, _pickup!.lng, icon: Icons.my_location, label: 'Pickup'),
                  if (_dropoff != null) MapPin(_dropoff!.lat, _dropoff!.lng, icon: Icons.flag, color: raastaAmber, label: 'Drop-off'),
                ]),
        ),
        SafeArea(child: Padding(padding: const EdgeInsets.all(8), child: IconButton.filledTonal(tooltip: 'Back', onPressed: () => Navigator.pop(context), icon: const Icon(Icons.arrow_back)))),
        Positioned(
          left: 0, right: 0, bottom: 0,
          child: MapSheet(child: Material(type: MaterialType.transparency, child: SizedBox(width: double.infinity, child: ConstrainedBox(constraints: BoxConstraints(maxHeight: size.height * 0.62), child: SingleChildScrollView(child: _sheet(context)))))),
        ),
      ]),
    );
  }

  Widget _sheet(BuildContext context) {
    final t = Theme.of(context);
    final opts = asJsonList(_quote?['options']);
    final tags = recommendationTags(_quote?['recommendations']);
    final o = _option;
    final fare = asJson(o?['fare']);
    final rec = dbl(fare['recommended']).round();
    final offer = _offer ?? rec;
    final payable = (offer - dbl(fare['discount'])).clamp(0, 1e9);
    final ctx = asJson(_quote?['context']);
    final detail = _quote == null ? null : '${km(_quote!['distanceM'] as num?)} · ${minutes(_quote!['durationS'] as num?)}${ctx['zoneName'] != null && ctx['demandLevel'] != null ? ' · ${upper1(ctx['demandLevel'].toString())} demand near ${ctx['zoneName']}' : ''}';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (widget.note != null && _quote == null && !_quoting) InlineBanner(widget.note!, icon: Icons.auto_awesome_outlined, tone: t.colorScheme.primary),
      if (_editing || _pickup == null || _dropoff == null)
        RouteEditor(api: widget.api, pickup: _pickup, dropoff: _dropoff, saved: _saved, onPickup: (p) { setState(() => _pickup = p); _getQuote(); }, onDropoff: (p) { setState(() => _dropoff = p); _getQuote(); }, onEdited: () {})
      else
        RouteSummary(pickup: _pickup!, dropoff: _dropoff!, detail: detail, onEdit: () => setState(() => _editing = true)),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: InlineBanner(_error!, icon: Icons.error_outline, action: _quote == null && !_editing ? 'Retry' : null, onAction: _getQuote)),
      if (_quoting) const Padding(padding: EdgeInsets.only(top: 12), child: SkeletonList(count: 3, height: 64)),
      if (_quote != null && !_editing) ...[
        const SizedBox(height: 8),
        if (opts.isEmpty) const InlineBanner('No ride types are available for this trip right now.', icon: Icons.info_outline),
        for (final op in opts) OptionCard(option: op, selected: op['productCode'] == _product, tags: tags[op['productCode']] ?? const [], onTap: () => setState(() { _product = op['productCode'] as String; _offer = null; _seats = 1; })),
        if (o != null) ...[
          FareExplain(option: o, recommendations: asJsonList(_quote!['recommendations'])),
          OfferStepper(fare: fare, offer: offer, onChanged: (v) => setState(() => _offer = v)),
          const Divider(height: 24),
          PaymentRow(method: _payment, info: _info, payable: payable, onChanged: (v) => setState(() => _payment = v)),
          BookingExtras(
            promo: _promo, onApplyPromo: _getQuote, safety: _safety, onSafety: (v) => setState(() => _safety = v), promoMessage: _promoMsg, promoOk: _promoOk,
            seats: o['isShared'] == true ? _seats : null, maxSeats: ((o['capacity'] as num?)?.toInt() ?? 4).clamp(1, 4), onSeats: (v) => setState(() => _seats = v),
          ),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : _request, child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text('Request ${o['name']} · ${money(payable)}')),
          TextButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ScheduleRideScreen(api: widget.api, pickup: _pickup, dropoff: _dropoff, productCode: _product))), icon: const Icon(Icons.schedule), label: const Text('Schedule for later instead')),
        ],
      ],
    ]);
  }
}
