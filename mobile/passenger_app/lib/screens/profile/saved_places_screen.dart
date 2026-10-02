import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';
import '../../util/place.dart';
import '../../widgets/load_view.dart';
import '../../widgets/place_field.dart';
import '../../widgets/sheets.dart';

IconData labelIcon(String? l) => l == 'HOME' ? Icons.home_outlined : (l == 'WORK' ? Icons.work_outline : Icons.star_outline);

/// Saved places: add, rename, move and delete (GET/POST/PATCH/DELETE /me/places).
class SavedPlacesScreen extends StatefulWidget {
  const SavedPlacesScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<SavedPlacesScreen> createState() => _SavedPlacesScreenState();
}

class _SavedPlacesScreenState extends State<SavedPlacesScreen> {
  final _view = GlobalKey<LoadViewState<List<Json>>>();

  Future<void> _edit([Json? existing]) async {
    final ok = await showAppSheet<bool>(context, (c) => _PlaceSheet(api: widget.api, existing: existing));
    if (ok == true) _view.currentState?.reload();
  }

  Future<void> _delete(Json p) async {
    if (!await confirmDialog(context, title: 'Delete ${p['name']}?', message: 'This place will be removed from your saved places.', confirm: 'Delete', destructive: true)) return;
    try {
      await widget.api.delete('/me/places/${p['id']}');
      _view.currentState?.reload();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.friendly);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Saved places')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _edit, icon: const Icon(Icons.add_location_alt_outlined), label: const Text('Add place')),
      body: LoadView<List<Json>>(
        key: _view,
        load: () async => asJsonList(await widget.api.get('/me/places')),
        isEmpty: (l) => l.isEmpty,
        empty: EmptyState(icon: Icons.bookmark_add_outlined, title: 'No saved places', message: 'Save home and work for one-tap booking.', action: 'Add a place', onAction: _edit),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        builder: (c, list, _) => [
          for (final p in list)
            Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(icon: labelIcon(p['label'] as String?), title: '${p['name']}', subtitle: '${p['address'] ?? ''}', onTap: () => _edit(p), trailing: IconButton(tooltip: 'Delete ${p['name']}', icon: const Icon(Icons.delete_outline), onPressed: () => _delete(p)))),
        ],
      ),
    );
  }
}

class _PlaceSheet extends StatefulWidget {
  const _PlaceSheet({required this.api, this.existing});
  final ApiClient api;
  final Json? existing;
  @override
  State<_PlaceSheet> createState() => _PlaceSheetState();
}

class _PlaceSheetState extends State<_PlaceSheet> {
  late final _name = TextEditingController(text: '${widget.existing?['name'] ?? ''}');
  late String _label = '${widget.existing?['label'] ?? 'FAVORITE'}';
  Place? _place;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final editing = widget.existing != null;
    if (_name.text.trim().isEmpty || (!editing && _place == null)) {
      setState(() => _error = editing ? 'Enter a name.' : 'Enter a name and search for the place.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      if (editing) {
        await widget.api.patch('/me/places/${widget.existing!['id']}', body: {'name': _name.text.trim(), if (_place != null) 'address': _place!.address, if (_place != null) 'location': {'lat': _place!.lat, 'lng': _place!.lng}});
      } else {
        await widget.api.post('/me/places', body: {'label': _label, 'name': _name.text.trim(), 'address': _place!.address, 'lat': _place!.lat, 'lng': _place!.lng});
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SheetTitle(editing ? 'Edit place' : 'Add a place'),
      if (!editing) ...[
        SegmentedButton<String>(segments: const [ButtonSegment(value: 'HOME', label: Text('Home'), icon: Icon(Icons.home_outlined)), ButtonSegment(value: 'WORK', label: Text('Work'), icon: Icon(Icons.work_outline)), ButtonSegment(value: 'FAVORITE', label: Text('Other'), icon: Icon(Icons.star_outline))], selected: {_label}, onSelectionChanged: (s) => setState(() => _label = s.first)),
        const SizedBox(height: 12),
      ],
      TextField(controller: _name, decoration: const InputDecoration(labelText: 'Name', hintText: 'e.g. Home, Office, Gym', prefixIcon: Icon(Icons.label_outline))),
      const SizedBox(height: 12),
      PlaceField(api: widget.api, label: editing ? 'Move to another place (optional)' : 'Search for the place', icon: Icons.search, onPicked: (p) => setState(() { _place = p; if (_name.text.trim().isEmpty) _name.text = _label == 'HOME' ? 'Home' : (_label == 'WORK' ? 'Work' : p.name); })),
      if (editing && _place == null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Currently: ${widget.existing!['address'] ?? ''}', style: Theme.of(context).textTheme.bodySmall)),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      const SizedBox(height: 16),
      FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save place')),
    ]);
  }
}
