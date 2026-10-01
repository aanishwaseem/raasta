import 'package:flutter/material.dart';

/// Asks the rider to type DELETE before the account can be removed. Pops true when confirmed.
class DeleteAccountDialog extends StatefulWidget {
  const DeleteAccountDialog({super.key});
  @override
  State<DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<DeleteAccountDialog> {
  final _typed = TextEditingController();

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Delete your account?'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('This is permanent. Your profile, saved places and contacts are removed and you are signed out. Trip and payment records may be kept where the law requires.'),
        const SizedBox(height: 12),
        TextField(controller: _typed, autofocus: true, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'Type DELETE to confirm')),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep my account')),
        TextButton(style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error), onPressed: _typed.text.trim() == 'DELETE' ? () => Navigator.pop(context, true) : null, child: const Text('Delete account')),
      ],
    );
  }
}
