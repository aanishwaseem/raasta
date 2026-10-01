import 'dart:async';

import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/place.dart';
import '../util/json.dart';

/// Text field with place suggestions from GET /places/search.
/// [shortcuts] (saved places, current location) show while the field is focused and empty.
class PlaceField extends StatefulWidget {
  const PlaceField({super.key, required this.api, required this.label, required this.icon, required this.onPicked, this.initial, this.shortcuts = const [], this.near, this.autofocus = false, this.onEdited, this.iconColor});
  final ApiClient api;
  final String label;
  final IconData icon;
  final Color? iconColor;
  final Place? initial;
  final List<Place> shortcuts;
  final Place? near;
  final bool autofocus;
  final ValueChanged<Place> onPicked;
  final VoidCallback? onEdited;

  @override
  State<PlaceField> createState() => _PlaceFieldState();
}

class _PlaceFieldState extends State<PlaceField> {
  late final _c = TextEditingController(text: widget.initial?.name ?? '');
  final _focus = FocusNode();
  List<Place> _results = [];
  Timer? _debounce;
  bool _searching = false;
  bool _failed = false;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  void _onChanged(String q) {
    widget.onEdited?.call();
    _debounce?.cancel();
    if (q.trim().length < 2) {
      _seq++;
      setState(() { _results = []; _searching = false; _failed = false; });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () => _search(q));
  }

  Future<void> _search(String q) async {
    final my = ++_seq;
    setState(() => _searching = true);
    try {
      final near = widget.near;
      final r = await widget.api.get('/places/search', query: {'q': q.trim(), if (near != null) 'lat': '${near.lat}', if (near != null) 'lng': '${near.lng}'});
      if (my == _seq && mounted) setState(() { _results = asJsonList(r).map(Place.fromJson).toList(); _searching = false; _failed = false; });
    } on ApiException {
      if (my == _seq && mounted) setState(() { _results = []; _searching = false; _failed = true; });
    }
  }

  void _pick(Place p) {
    _debounce?.cancel();
    _seq++;
    _c.text = p.name;
    _focus.unfocus();
    setState(() { _results = []; _searching = false; });
    widget.onPicked(p);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _c.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final showShortcuts = _focus.hasFocus && _c.text.isEmpty && widget.shortcuts.isNotEmpty;
    final list = showShortcuts ? widget.shortcuts : _results;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        controller: _c,
        focusNode: _focus,
        autofocus: widget.autofocus,
        onChanged: _onChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          labelText: widget.label,
          prefixIcon: Icon(widget.icon, color: widget.iconColor),
          suffixIcon: _searching
              ? const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
              : (_c.text.isEmpty ? null : IconButton(tooltip: 'Clear', icon: const Icon(Icons.close), onPressed: () { _c.clear(); _onChanged(''); setState(() {}); })),
        ),
      ),
      if (_failed) Padding(padding: const EdgeInsets.fromLTRB(8, 8, 8, 0), child: Text('Search is unavailable right now. Check your connection.', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.error))),
      if (!_failed && !_searching && _results.isEmpty && _c.text.trim().length >= 2 && !showShortcuts && _focus.hasFocus)
        Padding(padding: const EdgeInsets.fromLTRB(8, 8, 8, 0), child: Text('No places found. Try a landmark or area name.', style: t.textTheme.bodySmall)),
      for (final p in list)
        ListTile(
          minVerticalPadding: 8,
          leading: Icon(showShortcuts ? Icons.bookmark_outline : Icons.place_outlined),
          title: Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Text(p.address, maxLines: 1, overflow: TextOverflow.ellipsis),
          onTap: () => _pick(p),
        ),
    ]);
  }
}
