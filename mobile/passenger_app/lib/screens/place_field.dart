import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

class Place {
  const Place(this.name, this.address, this.lat, this.lng);
  final String name;
  final String address;
  final double lat;
  final double lng;

  factory Place.fromJson(Map<String, dynamic> j) => Place(j['name'] as String, (j['address'] ?? j['name']) as String, (j['location']['lat'] as num).toDouble(), (j['location']['lng'] as num).toDouble());
  Map<String, dynamic> toRequest() => {'lat': lat, 'lng': lng, 'address': address};
}

/// Text field with place suggestions from GET /places/search.
class PlaceField extends StatefulWidget {
  const PlaceField({super.key, required this.api, required this.label, required this.icon, required this.onPicked, this.initial});
  final ApiClient api;
  final String label;
  final IconData icon;
  final Place? initial;
  final ValueChanged<Place> onPicked;

  @override
  State<PlaceField> createState() => _PlaceFieldState();
}

class _PlaceFieldState extends State<PlaceField> {
  late final _c = TextEditingController(text: widget.initial?.name ?? '');
  List<Place> _results = [];
  int _seq = 0;

  Future<void> _search(String q) async {
    final my = ++_seq;
    if (q.trim().length < 2) {
      setState(() => _results = []);
      return;
    }
    try {
      final r = await widget.api.get('/places/search', query: {'q': q.trim()}) as List;
      if (my == _seq && mounted) setState(() => _results = r.map((e) => Place.fromJson(e as Map<String, dynamic>)).toList());
    } on ApiException {
      if (my == _seq && mounted) setState(() => _results = []);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(controller: _c, onChanged: _search, decoration: InputDecoration(labelText: widget.label, prefixIcon: Icon(widget.icon))),
      for (final p in _results)
        ListTile(
          dense: true,
          leading: const Icon(Icons.place_outlined),
          title: Text(p.name),
          subtitle: Text(p.address, maxLines: 1, overflow: TextOverflow.ellipsis),
          onTap: () {
            _c.text = p.name;
            setState(() => _results = []);
            widget.onPicked(p);
          },
        ),
    ]);
  }
}
