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
  final _referral = TextEditingController();
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
        await widget.api.register(fullName: _name.text.trim(), email: id.contains('@') ? id : null, phone: id.contains('@') ? null : id, password: _pw.text, role: widget.role, referralCode: _referral.text.trim().toUpperCase());
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
    _referral.dispose();
    _code.dispose();
    super.dispose();
  }

  void _fillDemo(String email) => setState(() { _id.text = email; _pw.text = 'Passw0rd!test'; _signup = false; _phone = false; _error = null; });

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final driver = widget.role == 'DRIVER';
    final demo = const bool.fromEnvironment('DEMO_LOGIN') ? (driver ? ['usman@raasta.test'] : ['bilal@raasta.test']) : const <String>[];
    final heroColors = driver ? const [Color(0xFF0B1F24), Color(0xFF134E4A)] : const [Color(0xFF0F766E), Color(0xFF14B8A6)];
    return Scaffold(
      backgroundColor: t.scaffoldBackgroundColor,
      body: SingleChildScrollView(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            padding: EdgeInsets.fromLTRB(28, MediaQuery.of(context).padding.top + 40, 28, 36),
            decoration: BoxDecoration(gradient: LinearGradient(colors: heroColors, begin: Alignment.topLeft, end: Alignment.bottomRight), borderRadius: const BorderRadius.vertical(bottom: Radius.circular(32))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(14)), child: Icon(driver ? Icons.local_taxi_rounded : Icons.route_rounded, color: Colors.white, size: 30)),
              const SizedBox(height: 20),
              Text(driver ? 'Raasta Driver' : 'Raasta', style: t.textTheme.displaySmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800, letterSpacing: -1)),
              const SizedBox(height: 6),
              Text(driver ? 'Earn smarter. Know where demand is before you drive.' : 'Predictable, safe and fairly priced rides across Pakistan.', style: t.textTheme.bodyLarge?.copyWith(color: Colors.white.withValues(alpha: 0.9))),
            ]),
          ),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(_phone ? (_codeSent ? 'Enter your code' : 'Sign in with your phone') : _signup ? widget.title : 'Welcome back', style: t.textTheme.headlineSmall),
                  const SizedBox(height: 16),
                  if (_signup || (_phone && _codeSent)) ...[TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name', prefixIcon: Icon(Icons.person_outline))), const SizedBox(height: 12)],
                  TextField(controller: _id, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.username], decoration: InputDecoration(prefixIcon: Icon(_phone ? Icons.phone_outlined : Icons.alternate_email), labelText: _phone ? 'Phone (+92...)' : _signup ? 'Email or phone (+92...)' : 'Email or phone')),
                  const SizedBox(height: 12),
                  if (_phone && _codeSent) ...[
                    TextField(controller: _code, onChanged: (_) => setState(() {}), keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: '6-digit code', prefixIcon: Icon(Icons.sms_outlined), counterText: '')),
                    if (_hint != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(_hint!, style: t.textTheme.bodySmall)),
                  ] else if (!_phone)
                    TextField(controller: _pw, obscureText: true, autofillHints: const [AutofillHints.password], onSubmitted: (_) => _submit(), decoration: InputDecoration(prefixIcon: const Icon(Icons.lock_outline), labelText: _signup ? 'Password (8+ characters, letters and numbers)' : 'Password')),
                  if (_signup && !driver && !_phone) ...[const SizedBox(height: 12), TextField(controller: _referral, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(prefixIcon: Icon(Icons.card_giftcard_outlined), labelText: 'Referral code (optional)'))],
                  if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Row(children: [Icon(Icons.error_outline, size: 18, color: t.colorScheme.error), const SizedBox(width: 8), Expanded(child: Text(_error!, style: TextStyle(color: t.colorScheme.error)))])),
                  const SizedBox(height: 20),
                  FilledButton(onPressed: _busy || (_phone && _codeSent && _code.text.trim().length != 6) ? null : _submit, child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text(_phone ? (_codeSent ? 'Verify and continue' : 'Send code') : _signup ? 'Create account' : 'Sign in')),
                  if (demo.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    OutlinedButton.icon(onPressed: _busy ? null : () => _fillDemo(demo.first), icon: const Icon(Icons.bolt), label: Text(driver ? 'Fill demo driver login' : 'Fill demo rider login')),
                  ],
                  if (!_phone) TextButton(onPressed: _busy ? null : () => setState(() { _signup = !_signup; _error = null; }), child: Text(_signup ? 'I already have an account' : 'Create an account')),
                  TextButton(onPressed: _busy ? null : () => setState(() { _phone = !_phone; _signup = false; _codeSent = false; _error = null; }), child: Text(_phone ? 'Use email and password instead' : 'Use a phone code instead')),
                  TextButton.icon(onPressed: _busy ? null : _editServer, icon: const Icon(Icons.dns_outlined, size: 18), label: Text('Server: ${Uri.tryParse(widget.api.baseUrl)?.authority ?? widget.api.baseUrl}')),
                ]),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}
