import 'package:flutter/material.dart';

import 'api_client.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.role, required this.title, required this.onLoggedIn});
  final ApiClient api;
  final String role;
  final String title;
  final VoidCallback onLoggedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _pw = TextEditingController();
  final _name = TextEditingController();
  bool _signup = false;
  bool _phone = false;
  bool _codeSent = false;
  final _code = TextEditingController();
  String? _hint;
  String? _error;
  bool _busy = false;

  Future<void> _sendCode() async {
    setState(() { _busy = true; _error = null; });
    try {
      final r = await widget.api.requestOtp(_id.text.trim());
      if (!mounted) return;
      setState(() { _codeSent = true; _hint = r['devCode'] != null ? 'Development code: ${r['devCode']}' : 'We sent a 6-digit code by SMS.'; if (r['devCode'] != null) _code.text = '${r['devCode']}'; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyCode() async {
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.verifyOtp(_id.text.trim(), _code.text.trim(), fullName: _name.text.trim(), requiredRole: widget.role);
      widget.onLoggedIn();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.code == 'NAME_REQUIRED' || e.message.toLowerCase().contains('name') ? 'Enter your name to create your account.' : e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    if (_phone) return _codeSent ? _verifyCode() : _sendCode();
    setState(() { _busy = true; _error = null; });
    try {
      if (_signup) {
        final id = _id.text.trim();
        await widget.api.register(fullName: _name.text.trim(), email: id.contains('@') ? id : null, phone: id.contains('@') ? null : id, password: _pw.text, role: widget.role);
      } else {
        await widget.api.login(_id.text.trim(), _pw.text, requiredRole: widget.role);
      }
      widget.onLoggedIn();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.friendly);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _editServer() async {
    final c = TextEditingController(text: Uri.tryParse(widget.api.baseUrl)?.authority ?? '');
    final v = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Server address'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('The computer running Raasta, as seen from this phone (same Wi-Fi). Example: 192.168.1.20:3000'),
          const SizedBox(height: 12),
          TextField(controller: c, autofocus: true, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Address')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, c.text), child: const Text('Save'))],
      ),
    );
    if (v == null) return;
    try {
      await widget.api.setServer(v);
      if (mounted) setState(() => _error = null);
    } on ArgumentError catch (e) {
      if (mounted) setState(() => _error = e.message.toString());
    }
  }

  @override
  void dispose() {
    _id.dispose();
    _pw.dispose();
    _name.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('Raasta', style: Theme.of(context).textTheme.displaySmall?.copyWith(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.w700)),
                Text(widget.title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 32),
                if (_signup || (_phone && _codeSent)) ...[TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name')), const SizedBox(height: 12)],
                TextField(controller: _id, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.username], decoration: InputDecoration(labelText: _phone ? 'Phone (+92...)' : _signup ? 'Email or phone (+92...)' : 'Email or phone')),
                const SizedBox(height: 12),
                if (_phone && _codeSent) ...[
                  TextField(controller: _code, onChanged: (_) => setState(() {}), keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: '6-digit code', counterText: '')),
                  if (_hint != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(_hint!, style: Theme.of(context).textTheme.bodySmall)),
                ] else if (!_phone)
                  TextField(controller: _pw, obscureText: true, autofillHints: const [AutofillHints.password], onSubmitted: (_) => _submit(), decoration: InputDecoration(labelText: _signup ? 'Password (8+ characters, letters and numbers)' : 'Password')),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                const SizedBox(height: 20),
                FilledButton(onPressed: _busy || (_phone && _codeSent && _code.text.trim().length != 6) ? null : _submit, child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(_phone ? (_codeSent ? 'Verify and continue' : 'Send code') : _signup ? 'Create account' : 'Sign in')),
                if (!_phone) TextButton(onPressed: _busy ? null : () => setState(() { _signup = !_signup; _error = null; }), child: Text(_signup ? 'I already have an account' : 'Create an account')),
                TextButton(onPressed: _busy ? null : _editServer, child: Text('Server: ${Uri.tryParse(widget.api.baseUrl)?.authority ?? widget.api.baseUrl}')),
                TextButton(onPressed: _busy ? null : () => setState(() { _phone = !_phone; _signup = false; _codeSent = false; _error = null; }), child: Text(_phone ? 'Use email and password instead' : 'Use a phone code instead')),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
