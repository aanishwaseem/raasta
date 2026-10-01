import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util.dart';
import 'ticket_screen.dart';

const ticketCategories = {
  'PAYMENT': 'Payment or payout',
  'FARE': 'Fare problem',
  'PASSENGER_BEHAVIOUR': 'Rider behaviour',
  'SAFETY': 'Safety',
  'ACCOUNT': 'Account or documents',
  'APP_ISSUE': 'App problem',
  'LOST_ITEM': 'Lost item',
  'OTHER': 'Something else',
};

/// Support tickets: list, open a new one, read replies.
class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  Key _reload = UniqueKey();

  Future<List<Map<String, dynamic>>> _load() async => asList(asMap(await widget.api.get('/support/tickets', query: {'page': '1', 'pageSize': '30'}))['items']);

  Future<void> _new() async {
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _NewTicket(api: widget.api));
    if (ok == true && mounted) {
      toast(context, 'Ticket sent. Our team will reply here.');
      setState(() => _reload = UniqueKey());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Support')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _new, icon: const Icon(Icons.add), label: const Text('New ticket')),
      body: AsyncBody<List<Map<String, dynamic>>>(
        key: _reload,
        load: _load,
        isEmpty: (l) => l.isEmpty,
        empty: EmptyState(icon: Icons.support_agent, title: 'No support tickets', message: 'Need help with a trip, payout or your account? Tell us and we will reply here.', action: 'Contact support', onAction: _new),
        builder: (context, tickets, refresh) => RefreshIndicator(
          onRefresh: refresh,
          child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
            for (final t in tickets)
              Padding(padding: const EdgeInsets.only(bottom: 8), child: InfoTile(
                icon: Icons.confirmation_number_outlined,
                title: '${t['subject']}',
                subtitle: ticketCategories['${t['category']}'] ?? '${t['category']}',
                trailing: StatusPill(prettyStatus('${t['status']}')),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TicketScreen(api: widget.api, ticketId: '${t['id']}'))),
              )),
          ]),
        ),
      ),
    );
  }
}

class _NewTicket extends StatefulWidget {
  const _NewTicket({required this.api});
  final ApiClient api;
  @override
  State<_NewTicket> createState() => _NewTicketState();
}

class _NewTicketState extends State<_NewTicket> {
  final _form = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _body = TextEditingController();
  String _cat = 'PAYMENT';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!_form.currentState!.validate()) return;
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/support/tickets', body: {'category': _cat, 'subject': _subject.text.trim(), 'body': _body.text.trim()});
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _error = errorText(e); _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.viewInsetsOf(context).bottom + 16),
      child: SingleChildScrollView(child: Form(key: _form, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('How can we help?', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: _cat, isExpanded: true, decoration: const InputDecoration(labelText: 'Topic'), items: [for (final e in ticketCategories.entries) DropdownMenuItem(value: e.key, child: Text(e.value))], onChanged: (v) => setState(() => _cat = v!)),
        const SizedBox(height: 12),
        TextFormField(controller: _subject, maxLength: 120, decoration: const InputDecoration(labelText: 'Subject'), validator: (v) => (v ?? '').trim().length < 3 ? 'Add a short subject (3+ characters)' : null),
        TextFormField(controller: _body, maxLength: 2000, maxLines: 4, decoration: const InputDecoration(labelText: 'Describe the problem'), validator: (v) => (v ?? '').trim().length < 3 ? 'Tell us a little more' : null),
        if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        FilledButton(onPressed: _busy ? null : _send, child: _busy ? const CircularProgressIndicator() : const Text('Send')),
      ]))),
    );
  }
}
