import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../../util/json.dart';

/// Edit name, email, gender and language (PATCH /me).
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key, required this.api, required this.me});
  final ApiClient api;
  final Json me;
  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  late final _name = TextEditingController(text: '${widget.me['fullName'] ?? ''}');
  late final _email = TextEditingController(text: '${widget.me['email'] ?? ''}');
  late String _gender = const ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'].contains(widget.me['gender']) ? widget.me['gender'] as String : 'UNDISCLOSED';
  late String _locale = widget.me['locale'] == 'ur' ? 'ur' : 'en';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final email = _email.text.trim();
    if (name.length < 2) {
      setState(() => _error = 'Please enter your name.');
      return;
    }
    if (email.isNotEmpty && !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      setState(() => _error = 'That email address does not look right.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.patch('/me', body: {'fullName': name, if (email.isNotEmpty && email != widget.me['email']) 'email': email, 'gender': _gender, 'locale': _locale});
      if (!mounted) return;
      toast(context, 'Profile updated.');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.friendly; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Edit profile')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name', prefixIcon: Icon(Icons.person_outline))),
        const SizedBox(height: 12),
        TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline))),
        const SizedBox(height: 12),
        InputDecorator(decoration: const InputDecoration(labelText: 'Phone'), child: Text('${widget.me['phone'] ?? 'Not set'}')),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _gender,
          decoration: const InputDecoration(labelText: 'Gender', helperText: 'Used for safety features such as women-driver preference.'),
          items: const [DropdownMenuItem(value: 'FEMALE', child: Text('Female')), DropdownMenuItem(value: 'MALE', child: Text('Male')), DropdownMenuItem(value: 'OTHER', child: Text('Other')), DropdownMenuItem(value: 'UNDISCLOSED', child: Text('Prefer not to say'))],
          onChanged: (v) => setState(() => _gender = v ?? _gender),
        ),
        const SizedBox(height: 12),
        SegmentedButton<String>(segments: const [ButtonSegment(value: 'en', label: Text('English')), ButtonSegment(value: 'ur', label: Text('اردو'))], selected: {_locale}, onSelectionChanged: (s) => setState(() => _locale = s.first)),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save changes')),
      ]),
    );
  }
}
