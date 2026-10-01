import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../util/place.dart';
import '../../widgets/banner.dart';
import '../../widgets/full_bleed_map.dart';
import '../assistant/assistant_screen.dart';
import '../booking/booking_screen.dart';
import '../intercity/intercity_screen.dart';
import '../profile/saved_places_screen.dart';
import '../schedule/schedule_screen.dart';
import '../trip/trip_screen.dart';
import 'home_sections.dart';

/// Map-first home: where to, saved and recent places, smart suggestions (explicit tap to book), upcoming rides, voice.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.location});
  final ApiClient api;
  final DeviceLocation location;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Place? _pickup;
  String? _locNote;
  String _name = '';
  List<Place> _saved = [];
  List<Json> _savedRaw = [];
  List<Json> _recent = [];
  List<Json> _suggestions = [];
  List<Json> _upcoming = [];
  Json? _active;
  final _dismissed = <String>{};
  bool _loaded = false;
  String? _loadError;
  bool _autoOpened = false;

  @override
  void initState() {
    super.initState();
    _name = firstName(widget.api.session?.name);
    _locate();
    _loadAll();
  }

  /// Pickup starts at the device location (reverse-geocoded to a name); falls back to the city centre with a note.
  Future<void> _locate() async {
    final f = await widget.location.current();
    var name = 'Current location';
    var address = 'Current location';
    try {
      final r = await widget.api.get('/places/reverse', query: {'lat': '${f.lat}', 'lng': '${f.lng}'});
      if (r is Map) {
        name = (r['name'] ?? name) as String;
        address = (r['address'] ?? name) as String;
      }
    } on ApiException {/* keep generic label */}
    if (!mounted) return;
    setState(() {
      _pickup = Place(f.approximate ? 'City centre' : name, f.approximate ? 'City centre' : address, f.lat, f.lng);
      _locNote = f.approximate ? '${widget.location.lastProblem ?? 'Using an approximate location.'} Search for your pickup in the next step.' : null;
    });
  }

  Future<T> _safe<T>(Future<dynamic> f, T Function(dynamic) map, T fallback, List<Object> errors) async {
    try {
      return map(await f);
    } catch (e) {
      errors.add(e);
      return fallback;
    }
  }

  Future<void> _loadAll() async {
    final errors = <Object>[];
    final r = await Future.wait<Object?>([
      _safe(widget.api.get('/me'), (v) => asJson(v)['fullName'] as String?, null, errors),
      _safe(widget.api.get('/me/places'), asJsonList, <Json>[], errors),
      _safe(widget.api.get('/rides', query: {'pageSize': '12', 'status': 'COMPLETED'}), pageItems, <Json>[], errors),
      _safe(widget.api.get('/me/suggestions'), asJsonList, <Json>[], errors),
      _safe(widget.api.get('/scheduled-rides'), asJsonList, <Json>[], errors),
      _safe(widget.api.get('/rides/active'), (v) => v is Map && v['id'] != null ? asJson(v) : null, null, errors),
    ]);
    if (!mounted) return;
    final saved = r[1] as List<Json>;
    setState(() {
      _name = firstName(r[0] as String?).isNotEmpty ? firstName(r[0] as String?) : _name;
      _savedRaw = saved;
      _saved = saved.map(Place.fromJson).toList();
      _recent = r[2] as List<Json>;
      _suggestions = r[3] as List<Json>;
      _upcoming = r[4] as List<Json>;
      _active = r[5] as Json?;
      _loaded = true;
      _loadError = errors.length >= 3 ? (errors.any(isOffline) ? 'You appear to be offline. Some things may be out of date.' : 'Some of your info could not be loaded.') : null;
    });
    if (_active != null && !_autoOpened) {
      _autoOpened = true;
      _openTrip(_active!['id'] as String);
    }
  }

  Future<void> _push(Widget w) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => w));
    if (mounted) _loadAll();
  }

  void _openTrip(String id) => _push(TripScreen(api: widget.api, rideId: id, location: widget.location));

  void _book({Place? dropoff, Place? pickup, String? product, String? note}) => _push(BookingScreen(api: widget.api, location: widget.location, pickup: pickup ?? _pickup, dropoff: dropoff, productCode: product, note: note));

  Place? _savedByLabel(String label) {
    final i = _savedRaw.indexWhere((p) => p['label'] == label);
    return i < 0 ? null : _saved[i];
  }

  Future<void> _openRecent(Json ride) async {
    try {
      final full = asJson(await widget.api.get('/rides/${ride['id']}'));
      if (mounted) _book(dropoff: Place.fromPoint(asJson(full['dropoff'])));
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pins = [if (_pickup != null) MapPin(_pickup!.lat, _pickup!.lng, icon: Icons.my_location, label: 'You are here')];
    return Scaffold(
      body: Stack(fit: StackFit.expand, children: [
        Positioned.fill(child: _pickup == null ? const Center(child: CircularProgressIndicator()) : FullBleedMap(pins: pins)),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Column(children: [
              GreetingBar(name: _name, onAssistant: () => _push(AssistantScreen(api: widget.api, location: widget.location))),
              const SizedBox(height: 10),
              WhereToCard(onTap: () => _book(), onMic: () => _push(AssistantScreen(api: widget.api, location: widget.location, voiceMode: true))),
              if (_locNote != null) Padding(padding: const EdgeInsets.only(top: 8), child: Material(borderRadius: BorderRadius.circular(12), color: Theme.of(context).colorScheme.surface, child: Padding(padding: const EdgeInsets.all(10), child: Text(_locNote!, style: Theme.of(context).textTheme.bodySmall)))),
            ]),
          ),
        ),
        DraggableScrollableSheet(
          initialChildSize: 0.40, minChildSize: 0.14, maxChildSize: 0.88,
          builder: (context, controller) => _sheet(context, controller),
        ),
      ]),
    );
  }

  Widget _sheet(BuildContext context, ScrollController controller) {
    final t = Theme.of(context);
    final home = _savedByLabel('HOME'), work = _savedByLabel('WORK');
    final recentSeen = <String>{};
    final recent = [for (final r in _recent) if (recentSeen.add('${r['dropoffAddress']}')) r].take(3).toList();
    final suggestions = _suggestions.where((s) => !_dismissed.contains(s['routineId'])).toList();
    Widget chip(IconData i, String label, VoidCallback onTap) => Padding(padding: const EdgeInsets.only(right: 8), child: ActionChip(avatar: Icon(i, size: 18), label: Text(label), materialTapTargetSize: MaterialTapTargetSize.padded, onPressed: onTap));
    return Material(
      elevation: 12,
      color: t.colorScheme.surface,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      child: ListView(controller: controller, padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
        Center(child: Container(width: 40, height: 4, margin: const EdgeInsets.only(bottom: 12), decoration: BoxDecoration(color: t.colorScheme.outlineVariant, borderRadius: BorderRadius.circular(2)))),
        if (_loadError != null) InlineBanner(_loadError!, action: 'Retry', onAction: _loadAll),
        if (_active != null) ActiveRideCard(ride: _active!, onTap: () => _openTrip(_active!['id'] as String)),
        SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
          chip(Icons.home_outlined, home == null ? 'Add Home' : 'Home', () => home == null ? _push(SavedPlacesScreen(api: widget.api)) : _book(dropoff: home)),
          chip(Icons.work_outline, work == null ? 'Add Work' : 'Work', () => work == null ? _push(SavedPlacesScreen(api: widget.api)) : _book(dropoff: work)),
          for (final r in recent) chip(Icons.history, shortAddress(r['dropoffAddress'], parts: 1), () => _openRecent(r)),
        ])),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: _tile(context, Icons.schedule, 'Schedule', 'Plan ahead', () => _push(ScheduleScreen(api: widget.api, location: widget.location)))),
          const SizedBox(width: 8),
          Expanded(child: _tile(context, Icons.alt_route, 'Intercity', 'Share a seat', () => _push(IntercityScreen(api: widget.api)))),
        ]),
        if (!_loaded) const Padding(padding: EdgeInsets.only(top: 16), child: SkeletonList(count: 2, height: 90)),
        if (suggestions.isNotEmpty) ...[
          const SectionTitle('Your usual trips'),
          for (final s in suggestions)
            SuggestionCard(
              s: s,
              onDismiss: () => setState(() => _dismissed.add('${s['routineId']}')),
              onBook: () => _book(pickup: Place.fromPoint(asJson(s['pickup'])), dropoff: Place.fromPoint(asJson(s['dropoff'])), product: s['productCode'] as String?, note: '${s['reason'] ?? ''} Check the fare, then tap request.'),
            ),
        ],
        if (_upcoming.isNotEmpty) ...[
          SectionTitle('Upcoming rides', action: 'See all', onAction: () => _push(ScheduleScreen(api: widget.api, location: widget.location))),
          for (final u in _upcoming.take(2))
            Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(icon: Icons.event, title: whenText(u['pickupAt']), subtitle: '${shortAddress(asJson(u['pickup'])['address'], parts: 1)} → ${shortAddress(asJson(u['dropoff'])['address'], parts: 1)}${u['requiresConfirmation'] == true ? ' · needs your confirmation' : ''}', onTap: () => _push(ScheduleScreen(api: widget.api, location: widget.location)))),
        ],
        if (_loaded && suggestions.isEmpty && _upcoming.isEmpty && recent.isEmpty) Padding(padding: const EdgeInsets.only(top: 16), child: Text('Tap "Where to?" to see fares from several ride types. As you ride, Raasta can suggest your usual trips. You choose whether to book.', style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.onSurfaceVariant))),
      ]),
    );
  }

  Widget _tile(BuildContext context, IconData i, String title, String sub, VoidCallback onTap) => InfoTile(icon: i, title: title, subtitle: sub, onTap: onTap, trailing: const SizedBox.shrink());
}
