import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  late Future<Map<String, dynamic>> _f = _load();

  Future<Map<String, dynamic>> _load() async => await widget.api.get('/rides', query: {'pageSize': '30'}) as Map<String, dynamic>;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Activity')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _f,
        builder: (context, snap) {
          if (snap.hasError) {
            final msg = snap.error is ApiException ? (snap.error as ApiException).friendly : 'Could not load your rides.';
            return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(msg), TextButton(onPressed: () => setState(() => _f = _load()), child: const Text('Retry'))]));
          }
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final items = (snap.data!['items'] as List).cast<Map<String, dynamic>>();
          if (items.isEmpty) return const Center(child: Text('No rides yet.'));
          return ListView.separated(
            itemCount: items.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (_, i) {
              final r = items[i];
              return ListTile(
                title: Text('${r['pickupAddress']} → ${r['dropoffAddress']}', maxLines: 2, overflow: TextOverflow.ellipsis),
                subtitle: Text('${prettyStatus(r['status'] as String)} · ${(r['requestedAt'] as String).substring(0, 10)}'),
                trailing: Text(money(r['finalFare'] ?? r['offeredFare'])),
              );
            },
          );
        },
      ),
    );
  }
}
