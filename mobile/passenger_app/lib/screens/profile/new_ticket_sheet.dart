import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../widgets/sheets.dart';

const ticketCategories = ['FARE', 'LOST_ITEM', 'SAFETY', 'DRIVER_BEHAVIOUR', 'PAYMENT', 'ACCOUNT', 'APP_ISSUE', 'OTHER'];

/// Opens a support ticket (POST /support/tickets). Returns true when created.
Future<bool?> showNewTicketSheet(BuildContext context, ApiClient api, {String? rideId}) =>
    showAppSheet<bool>(context, (c) => _NewTicket(api: api, rideId: rideId));

class _NewTicket extends StatefulWidget {
  const _NewTicket({required this.api, this.rideId});
  final ApiClient api;
  final String? rideId;
  @override
  State<_NewTicket> createState() => _NewTicketState();
}

class _NewTicketState extends State<_NewTicket> {
  String _category = 'OTHER';
  final _subject = TextEditingController();
  final _body = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_subject.text.trim().length < 3 || _body.text.trim().length < 3) {
      setState(() => _error = 'Add a short subject and describe what happened.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/support/tickets', body: {'category': _category, 'subject': _subject.text.trim(), 'body': _body.text.trim(), if (widget.rideId != null) 'rideId': widget.rideId});
      if (!mounted) return;
      Navigator.pop(context, true);
      toast(context, 'Ticket sent. We will reply in Help and support.');
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SheetTitle('Contact support', subtitle: widget.rideId != null ? 'About your selected ride.' : null),
      if (_category == 'SAFETY') Padding(padding: const EdgeInsets.only(bottom: 12), child: Text('If you are in danger, call 15 now. Safety tickets are prioritised.', style: TextStyle(color: Theme.of(context).colorScheme.error))),
      DropdownButtonFormField<String>(initialValue: _category, decoration: const InputDecoration(labelText: 'Topic'), items: [for (final c in ticketCategories) DropdownMenuItem(value: c, child: Text(humanize(c)))], onChanged: (v) => setState(() => _category = v ?? _category)),
      const SizedBox(height: 12),
      TextField(controller: _subject, maxLength: 120, decoration: const InputDecoration(labelText: 'Subject')),
      TextField(controller: _body, maxLines: 4, maxLength: 2000, decoration: const InputDecoration(labelText: 'What happened?')),
      if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      FilledButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending…' : 'Send')),
    ]);
  }
}
