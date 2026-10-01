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
  String? _error;
  bool _busy = false;

  Future<void> _submit() async {
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

  @override
  void dispose() {
    _id.dispose();
    _pw.dispose();
    _name.dispose();
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
                if (_signup) ...[TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name')), const SizedBox(height: 12)],
                TextField(controller: _id, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.username], decoration: InputDecoration(labelText: _signup ? 'Email or phone (+92...)' : 'Email or phone')),
                const SizedBox(height: 12),
                TextField(controller: _pw, obscureText: true, autofillHints: const [AutofillHints.password], onSubmitted: (_) => _submit(), decoration: InputDecoration(labelText: _signup ? 'Password (8+ characters, letters and numbers)' : 'Password')),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                const SizedBox(height: 20),
                FilledButton(onPressed: _busy ? null : _submit, child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(_signup ? 'Create account' : 'Sign in')),
                TextButton(onPressed: _busy ? null : () => setState(() { _signup = !_signup; _error = null; }), child: Text(_signup ? 'I already have an account' : 'Create an account')),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
