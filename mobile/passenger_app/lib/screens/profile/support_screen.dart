import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/load_view.dart';
import 'new_ticket_sheet.dart';
import 'ticket_screen.dart';

Color _statusTone(BuildContext c, String s) => s == 'RESOLVED' || s == 'CLOSED' ? Colors.green.shade700 : (s == 'WAITING_ON_USER' ? const Color(0xFF9A6200) : Theme.of(c).colorScheme.primary);

/// Support tickets (GET /support/tickets).
class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  final _view = GlobalKey<LoadViewState<List<Json>>>();

  Future<void> _new() async {
    if (await showNewTicketSheet(context, widget.api) == true) _view.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Help and support')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _new, icon: const Icon(Icons.add_comment_outlined), label: const Text('New ticket')),
      body: LoadView<List<Json>>(
        key: _view,
        load: () async => pageItems(await widget.api.get('/support/tickets', query: {'pageSize': '30'})),
        isEmpty: (l) => l.isEmpty,
        empty: EmptyState(icon: Icons.support_agent_outlined, title: 'No tickets', message: 'Questions about a fare, a lost item or your account? We are here to help.', action: 'Contact support', onAction: _new),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        builder: (c, list, _) => [
          for (final x in list)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: InfoTile(
                icon: Icons.chat_bubble_outline,
                title: '${x['subject']}',
                subtitle: '${humanize('${x['category']}')} · ${whenText(x['updatedAt'] ?? x['createdAt'])}',
                trailing: StatusPill(humanize('${x['status']}'), color: _statusTone(c, '${x['status']}')),
                onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => TicketScreen(api: widget.api, ticketId: x['id'] as String))).then((_) => _view.currentState?.reload()),
              ),
            ),
        ],
      ),
    );
  }
}
