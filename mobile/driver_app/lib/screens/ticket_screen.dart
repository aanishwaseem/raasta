import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';

/// One support ticket with its conversation and a reply box.
class TicketScreen extends StatefulWidget {
  const TicketScreen({super.key, required this.api, required this.ticketId});
  final ApiClient api;
  final String ticketId;
  @override
  State<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends State<TicketScreen> {
  final _reply = TextEditingController();
  Key _reload = UniqueKey();
  bool _busy = false;

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty) return;
    setState(() => _busy = true);
    try {
      await widget.api.post('/support/tickets/${widget.ticketId}/messages', body: {'body': text});
      _reply.clear();
      if (mounted) setState(() => _reload = UniqueKey());
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ticket')),
      body: Column(children: [
        Expanded(
          child: AsyncBody<Map<String, dynamic>>(
            key: _reload,
            load: () async => asMap(await widget.api.get('/support/tickets/${widget.ticketId}')),
            builder: (context, t, refresh) {
              final msgs = asList(t['messages']);
              return RefreshIndicator(
                onRefresh: refresh,
                child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
                  Row(children: [Expanded(child: Text('${t['subject']}', style: Theme.of(context).textTheme.titleLarge)), StatusPill(prettyStatus('${t['status']}'))]),
                  const SizedBox(height: 12),
                  for (final m in msgs) _Bubble(author: '${m['authorName'] ?? ''}', body: '${m['body']}', mine: m['authorKind'] != 'AGENT'),
                ]),
              );
            },
          ),
        ),
        SafeArea(child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Row(children: [
            Expanded(child: TextField(controller: _reply, minLines: 1, maxLines: 3, decoration: const InputDecoration(hintText: 'Write a reply'))),
            const SizedBox(width: 8),
            IconButton.filled(iconSize: 28, constraints: const BoxConstraints(minWidth: 56, minHeight: 56), tooltip: 'Send reply', onPressed: _busy ? null : _send, icon: const Icon(Icons.send)),
          ]),
        )),
      ]),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.author, required this.body, required this.mine});
  final String author;
  final String body;
  final bool mine;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
        decoration: BoxDecoration(color: mine ? t.colorScheme.primary.withValues(alpha: 0.2) : t.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(16)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(author, style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.primary)), Text(body, style: t.textTheme.bodyLarge)]),
      ),
    );
  }
}
