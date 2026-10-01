import 'package:flutter/material.dart';

import '../util.dart';

enum StepKind { done, current, todo, error }

class OnboardingStep {
  const OnboardingStep(this.label, this.kind);
  final String label;
  final StepKind kind;
}

const _docStatusDone = {'DONE', 'OK', 'APPROVED', 'PENDING'};

/// Maps the server checklist onto the seven visible steps:
/// Register > Identity > Documents > Vehicle > Review > Training > Activate.
List<OnboardingStep> onboardingSteps(Map<String, dynamic> me) {
  final list = asList(me['checklist']);
  String statusOf(String key) => '${list.firstWhere((c) => c['key'] == key, orElse: () => const {'status': 'MISSING'})['status']}';
  const nonDoc = {'IDENTITY', 'VEHICLE', 'REVIEW', 'TRAINING'};
  final docs = list.where((c) => !nonDoc.contains(c['key'])).map((c) => '${c['status']}').toList();
  final status = '${me['status']}';

  final kinds = <StepKind>[
    StepKind.done,
    statusOf('IDENTITY') == 'DONE' ? StepKind.done : StepKind.todo,
    docs.any((s) => s == 'REJECTED' || s == 'EXPIRED') ? StepKind.error : docs.isNotEmpty && docs.every(_docStatusDone.contains) ? StepKind.done : StepKind.todo,
    switch (statusOf('VEHICLE')) { 'APPROVED' || 'DONE' || 'PENDING' => StepKind.done, 'REJECTED' => StepKind.error, _ => StepKind.todo },
    switch (status) { 'APPROVED' => StepKind.done, 'REJECTED' => StepKind.error, _ => StepKind.todo },
    statusOf('TRAINING') == 'DONE' ? StepKind.done : StepKind.todo,
    me['canGoOnline'] == true ? StepKind.done : StepKind.todo,
  ];
  // the first step that is not finished is "where you are now"
  final firstOpen = kinds.indexWhere((k) => k != StepKind.done);
  return [
    for (var i = 0; i < kinds.length; i++)
      OnboardingStep(const ['Register', 'Identity', 'Documents', 'Vehicle', 'Review', 'Training', 'Activate'][i], kinds[i] == StepKind.todo && i == firstOpen ? StepKind.current : kinds[i]),
  ];
}

class OnboardingStepper extends StatelessWidget {
  const OnboardingStepper({super.key, required this.steps});
  final List<OnboardingStep> steps;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var i = 0; i < steps.length; i++) ...[
          _Dot(index: i, step: steps[i]),
          if (i < steps.length - 1) Container(width: 18, height: 3, margin: const EdgeInsets.only(top: 20), color: steps[i].kind == StepKind.done ? goGreen : t.colorScheme.outlineVariant),
        ],
      ]),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.index, required this.step});
  final int index;
  final OnboardingStep step;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final (color, icon) = switch (step.kind) {
      StepKind.done => (goGreen, Icons.check),
      StepKind.error => (sosRed, Icons.priority_high),
      StepKind.current => (t.colorScheme.primary, null),
      StepKind.todo => (t.colorScheme.outline, null),
    };
    return Semantics(
      label: '${step.label}, ${step.kind.name}',
      child: SizedBox(
        width: 64,
        child: Column(children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(shape: BoxShape.circle, color: step.kind == StepKind.todo ? Colors.transparent : color, border: Border.all(color: color, width: 2)),
            child: Center(child: icon != null ? Icon(icon, color: Colors.black, size: 22) : Text('${index + 1}', style: TextStyle(fontWeight: FontWeight.w800, color: step.kind == StepKind.current ? Colors.black : color))),
          ),
          const SizedBox(height: 6),
          Text(step.label, textAlign: TextAlign.center, maxLines: 1, style: t.textTheme.labelSmall?.copyWith(fontWeight: step.kind == StepKind.current ? FontWeight.w800 : FontWeight.w500, color: step.kind == StepKind.todo ? t.colorScheme.onSurfaceVariant : null)),
        ]),
      ),
    );
  }
}
