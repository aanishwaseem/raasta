import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';


/// One-line copilot suggestion, always worded as a prediction. Tap for the basis and confidence.
class CopilotChip extends StatelessWidget {
  const CopilotChip({super.key, required this.recommendation, required this.disclaimer});
  final Map<String, dynamic> recommendation;
  final String? disclaimer;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Material(
      color: t.colorScheme.primary.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => CopilotDetail(recommendation: recommendation, disclaimer: disclaimer)),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(children: [
              Icon(Icons.auto_awesome, color: t.colorScheme.primary),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text('Copilot prediction', style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.primary, fontWeight: FontWeight.w800)),
                Text('${recommendation['title'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis, style: t.textTheme.titleSmall),
              ])),
              const Icon(Icons.chevron_right),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Full copilot card: detail, basis, confidence and the not-a-guarantee disclaimer.
class CopilotDetail extends StatelessWidget {
  const CopilotDetail({super.key, required this.recommendation, required this.disclaimer});
  final Map<String, dynamic> recommendation;
  final String? disclaimer;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [const Icon(Icons.auto_awesome), const SizedBox(width: 8), Expanded(child: Text('Driver AI Copilot', style: t.textTheme.titleLarge)), if (recommendation['confidence'] != null) StatusPill('Confidence: ${recommendation['confidence']}')]),
          const SizedBox(height: 12),
          Text('${recommendation['title'] ?? ''}', style: t.textTheme.titleMedium),
          const SizedBox(height: 6),
          Text('${recommendation['detail'] ?? ''}', style: t.textTheme.bodyLarge),
          if (recommendation['basis'] != null) ...[const SizedBox(height: 10), Text('Based on: ${recommendation['basis']}', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant))],
          const SizedBox(height: 10),
          Text(disclaimer ?? 'This is a prediction, not a guarantee of rides or earnings.', style: t.textTheme.bodySmall?.copyWith(color: raastaAmber)),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Got it')),
        ])),
      ),
    );
  }
}
