import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/banner.dart';

/// One ticket with its conversation and a reply box.
class TicketScreen extends StatefulWidget {
  const TicketScreen({super.key, required this.api, required this.ticketId});
  final ApiClient api;
  final String ticketId;
  @override
  State<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends State<TicketScreen> {
  Json? _t;
  String? _error;
  bool _busy = false;
  final _reply = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final t = asJson(await widget.api.get('/support/tickets/${widget.ticketId}'));
      if (mounted) setState(() { _t = t; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    }
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty) return;
    setState(() => _busy = true);
    try {
      final t = asJson(await widget.api.post('/support/tickets/${widget.ticketId}/messages', body: {'body': text}));
      _reply.clear();
      if (mounted) setState(() { _t = t; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final tk = _t;
    final closed = tk?['status'] == 'CLOSED';
    return Scaffold(
      appBar: AppBar(title: Text(tk == null ? 'Ticket' : '${tk['subject']}', maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: tk == null
          ? (_error == null ? const Padding(padding: EdgeInsets.all(16), child: SkeletonList()) : ErrorState(message: _error!, onRetry: _load))
          : Column(children: [
              Expanded(
                child: RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
                    Row(children: [StatusPill(humanize('${tk['status']}')), const SizedBox(width: 8), Text(humanize('${tk['category']}'), style: t.textTheme.bodySmall)]),
                    const SizedBox(height: 12),
                    for (final m in asJsonList(tk['messages']))
                      Align(
                        alignment: m['authorKind'] == 'AGENT' ? Alignment.centerLeft : Alignment.centerRight,
                        child: Container(
                          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(color: m['authorKind'] == 'AGENT' ? t.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6) : t.colorScheme.primary.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(16)),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${m['authorName'] ?? ''} · ${whenText(m['createdAt'])}', style: t.textTheme.labelSmall), const SizedBox(height: 2), Text('${m['body']}')]),
                        ),
                      ),
                  ]),
                ),
              ),
              if (_error != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: InlineBanner(_error!, icon: Icons.error_outline)),
              if (closed) const Padding(padding: EdgeInsets.all(16), child: Text('This ticket is closed. Open a new ticket if you need more help.')) else SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                  child: Row(children: [
                    Expanded(child: TextField(controller: _reply, minLines: 1, maxLines: 4, decoration: const InputDecoration(labelText: 'Reply'))),
                    const SizedBox(width: 8),
                    IconButton.filled(tooltip: 'Send reply', style: IconButton.styleFrom(minimumSize: const Size(56, 56)), onPressed: _busy ? null : _send, icon: const Icon(Icons.send)),
                  ]),
                ),
              ),
            ]),
    );
  }
}
