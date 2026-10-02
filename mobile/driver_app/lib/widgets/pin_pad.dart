import 'package:flutter/material.dart';

/// Numeric pad for the rider's 4-digit Ride PIN. Big keys, reachable with one thumb.
class PinPad extends StatelessWidget {
  const PinPad({super.key, required this.value, required this.onChanged, this.length = 4, this.enabled = true});
  final String value;
  final ValueChanged<String> onChanged;
  final int length;
  final bool enabled;

  void _tap(String k) {
    if (!enabled) return;
    if (k == 'back') {
      if (value.isNotEmpty) onChanged(value.substring(0, value.length - 1));
    } else if (k == 'clear') {
      onChanged('');
    } else if (value.length < length) {
      onChanged('$value$k');
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 0; i < length; i++)
          Container(
            key: ValueKey('pin-box-$i'),
            width: 56,
            height: 64,
            margin: const EdgeInsets.symmetric(horizontal: 6),
            alignment: Alignment.center,
            decoration: BoxDecoration(color: t.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(14), border: Border.all(color: i == value.length ? t.colorScheme.primary : t.colorScheme.outlineVariant, width: 2)),
            child: Text(i < value.length ? value[i] : '', style: t.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w900)),
          ),
      ]),
      const SizedBox(height: 12),
      for (final row in const [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['clear', '0', 'back']])
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(children: [
            for (final k in row)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: SizedBox(
                    height: 58,
                    child: FilledButton.tonal(
                      onPressed: enabled ? () => _tap(k) : null,
                      style: FilledButton.styleFrom(minimumSize: const Size(56, 56)),
                      child: k == 'back' ? const Icon(Icons.backspace_outlined) : k == 'clear' ? const Text('Clear', style: TextStyle(fontSize: 14)) : Text(k, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                    ),
                  ),
                ),
              ),
          ]),
        ),
    ]);
  }
}
