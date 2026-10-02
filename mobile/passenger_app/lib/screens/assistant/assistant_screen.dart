import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/format.dart';
import '../../util/json.dart';
import '../../widgets/banner.dart';
import '../safety/safety_screen.dart';
import '../trip/trip_screen.dart';
import 'assistant_cards.dart';

const _examples = ['Johar Town se Liberty jana hai', 'Book my usual trip', 'Where is my ride?', 'Why is my fare high?', 'Kal subah 8 baje airport'];

/// Chat and voice-style booking in English, Urdu or Roman Urdu.
/// Speech-to-text is not bundled: use the keyboard's microphone ("Type or dictate").
/// Booking, scheduling and cancelling always go through an explicit confirmation card.
class AssistantScreen extends StatefulWidget {
  const AssistantScreen({super.key, required this.api, required this.location, this.voiceMode = false});
  final ApiClient api;
  final DeviceLocation location;
  final bool voiceMode;
  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  final _msgs = <ChatMsg>[];
  final _input = TextEditingController();
  final _scroll = ScrollController();
  late bool _voice = widget.voiceMode;
  bool _busy = false;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _add(ChatMsg m) {
    setState(() => _msgs.add(m));
    WidgetsBinding.instance.addPostFrameCallback((_) { if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent + 200, duration: const Duration(milliseconds: 250), curve: Curves.easeOut); });
  }

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _input.text).trim();
    if (text.isEmpty || _busy) return;
    _input.clear();
    _add(ChatMsg(text, fromUser: true));
    setState(() => _busy = true);
    try {
      final f = await widget.location.current();
      final body = {(_voice ? 'transcript' : 'text'): text, if (!f.approximate) 'lat': f.lat, if (!f.approximate) 'lng': f.lng, if (RegExp(r'[؀-ۿ]').hasMatch(text)) 'locale': 'ur'};
      final r = asJson(await widget.api.post(_voice ? '/voice/parse' : '/assistant/message', body: body));
      final reply = (_voice ? r['confirmationText'] : r['reply'])?.toString() ?? 'Sorry, I did not catch that.';
      _add(ChatMsg(
        reply,
        pending: r['pendingAction'] is Map ? asJson(r['pendingAction']) : null,
        parsed: _voice ? r : null,
        options: asJsonList(r['options']),
        openSafety: asJson(r['data'])['openSafetyScreen'] == true,
      ));
    } on ApiException catch (e) {
      _add(ChatMsg(e.code == 'RATE_LIMITED' ? e.friendly : 'I could not reach Raasta. ${e.friendly}', error: true));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm(ChatMsg m, String? payment) async {
    final token = m.pending?['token'];
    try {
      final r = asJson(await widget.api.post('/assistant/confirm', body: {'token': token, 'paymentMethod': ?payment}));
      if (!mounted) return;
      setState(() => m.resolved = true);
      if (r['priceChanged'] == true) {
        _add(ChatMsg('${r['reply']}', pending: asJson(r['pendingAction'])));
      } else if (r['executed'] == 'BOOK_RIDE' && r['ride'] is Map) {
        _add(ChatMsg('Booked. Finding your driver now.'));
        Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, rideId: asJson(r['ride'])['id'] as String, location: widget.location)));
      } else if (r['executed'] == 'SCHEDULE_RIDE') {
        _add(ChatMsg('Scheduled for ${whenText(asJson(r['scheduledRide'])['pickupAt'])}. You can review it under Scheduled rides.'));
      } else if (r['executed'] == 'CANCEL_RIDE') {
        final fee = dbl(r['cancellationFee']);
        _add(ChatMsg(fee > 0 ? 'Your ride was cancelled. A fee of ${money(fee)} applies.' : 'Your ride was cancelled. No fee.'));
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.status == 409 || e.status == 410) setState(() => m.resolved = true);
      _add(ChatMsg(e.friendly, error: true));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Raasta Assistant'), actions: [IconButton(tooltip: _voice ? 'Switch to chat' : 'Switch to voice booking', onPressed: () => setState(() => _voice = !_voice), icon: Icon(_voice ? Icons.mic : Icons.mic_none, color: _voice ? t.colorScheme.primary : null))]),
      body: Column(children: [
        if (_voice) const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 0), child: InlineBanner('Voice mode: tap the microphone on your keyboard and speak, or type. I will show what I understood and ask you to confirm. Nothing is booked automatically.', icon: Icons.mic, tone: raastaTeal)),
        Expanded(
          child: _msgs.isEmpty
              ? ListView(padding: const EdgeInsets.all(16), children: [
                  const SizedBox(height: 24),
                  Icon(Icons.auto_awesome, size: 40, color: t.colorScheme.primary),
                  const SizedBox(height: 12),
                  Text('Where would you like to go?', textAlign: TextAlign.center, style: t.textTheme.titleLarge),
                  const SizedBox(height: 4),
                  Text('Ask in English, اردو or Roman Urdu. I can get fares, book, schedule, check your ride or explain a fare.', textAlign: TextAlign.center, style: t.textTheme.bodyMedium),
                  const SizedBox(height: 16),
                  Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 8, children: [for (final e in _examples) ActionChip(label: Text(e), onPressed: () => _send(e))]),
                ])
              : ListView(controller: _scroll, padding: const EdgeInsets.all(16), children: [for (final m in _msgs) ..._rows(m), if (_busy) const Padding(padding: EdgeInsets.all(8), child: Align(alignment: Alignment.centerLeft, child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5))))]),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(child: TextField(controller: _input, minLines: 1, maxLines: 4, maxLength: 500, textInputAction: TextInputAction.send, onSubmitted: (_) => _send(), decoration: InputDecoration(labelText: 'Type or dictate', hintText: 'e.g. Johar Town se Liberty jana hai', counterText: '', prefixIcon: Icon(_voice ? Icons.mic : Icons.chat_bubble_outline)))),
              const SizedBox(width: 8),
              IconButton.filled(tooltip: 'Send', style: IconButton.styleFrom(minimumSize: const Size(56, 56)), onPressed: _busy ? null : _send, icon: const Icon(Icons.send)),
            ]),
          ),
        ),
      ]),
    );
  }

  List<Widget> _rows(ChatMsg m) => [
        Bubble(msg: m),
        if (m.parsed != null && m.parsed!['intent'] != 'UNAVAILABLE') UnderstoodCard(parsed: m.parsed!),
        if (m.options.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 8), child: Wrap(spacing: 8, runSpacing: 8, children: [for (final o in m.options) ActionChip(avatar: const Icon(Icons.place_outlined, size: 18), label: Text('${o['name']}${o['address'] != null ? ', ${shortAddress(o['address'], parts: 1)}' : ''}'), onPressed: () => _send('${o['text'] ?? o['name']}'))])),
        if (m.pending != null) ConfirmCard(pending: m.pending!, disabled: m.resolved, onConfirm: (p) => _confirm(m, p), onDismiss: () { setState(() => m.resolved = true); _add(ChatMsg('Okay, I have not booked anything.')); }),
        if (m.openSafety) Padding(padding: const EdgeInsets.only(bottom: 8), child: OutlinedButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SafetyScreen(api: widget.api, location: widget.location))), icon: const Icon(Icons.shield_outlined), label: const Text('Open Safety'))),
      ];
}
