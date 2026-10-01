import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/json.dart';
import '../util/place.dart';
import 'banner.dart';
import 'option_card.dart';

/// Loads ride types and fare estimates for a trip and lets the rider choose one (used by scheduling).
class QuoteProductPicker extends StatefulWidget {
  const QuoteProductPicker({super.key, required this.api, required this.pickup, required this.dropoff, required this.selected, required this.onSelected});
  final ApiClient api;
  final Place pickup;
  final Place dropoff;
  final String? selected;
  final ValueChanged<String> onSelected;

  @override
  State<QuoteProductPicker> createState() => _QuoteProductPickerState();
}

class _QuoteProductPickerState extends State<QuoteProductPicker> {
  Json? _quote;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(QuoteProductPicker old) {
    super.didUpdateWidget(old);
    if (old.pickup != widget.pickup || old.dropoff != widget.dropoff) _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final q = asJson(await widget.api.post('/rides/quotes', body: {'pickup': widget.pickup.toRequest(), 'dropoff': widget.dropoff.toRequest()}));
      if (!mounted) return;
      final opts = asJsonList(q['options']);
      setState(() { _quote = q; _loading = false; });
      if (widget.selected == null && opts.isNotEmpty) widget.onSelected(opts.first['productCode'] as String);
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.friendly; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const SkeletonList(count: 2, height: 64);
    if (_error != null) return InlineBanner(_error!, icon: Icons.error_outline, action: 'Retry', onAction: _load);
    final opts = asJsonList(_quote?['options']);
    final tags = recommendationTags(_quote?['recommendations']);
    if (opts.isEmpty) return const InlineBanner('No ride types are available for this trip right now.', icon: Icons.info_outline);
    return Column(children: [
      for (final o in opts) OptionCard(option: o, selected: o['productCode'] == widget.selected, tags: tags[o['productCode']] ?? const [], onTap: () => widget.onSelected(o['productCode'] as String)),
    ]);
  }
}
