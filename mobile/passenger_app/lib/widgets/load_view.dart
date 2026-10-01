import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import '../util/json.dart';
import 'banner.dart';

/// Loads data once, then supports pull to refresh. Shows a skeleton while loading, an error state with retry,
/// an empty state, and keeps the last data (with a banner) when a refresh fails.
class LoadView<T> extends StatefulWidget {
  const LoadView({super.key, required this.load, required this.builder, this.isEmpty, this.empty, this.padding = const EdgeInsets.fromLTRB(16, 8, 16, 24), this.skeletons = 4});
  final Future<T> Function() load;
  final List<Widget> Function(BuildContext context, T data, Future<void> Function() reload) builder;
  final bool Function(T data)? isEmpty;
  final Widget? empty;
  final EdgeInsets padding;
  final int skeletons;

  @override
  State<LoadView<T>> createState() => LoadViewState<T>();
}

class LoadViewState<T> extends State<LoadView<T>> {
  T? _data;
  bool _has = false;
  bool _loading = true;
  String? _error;
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    if (mounted && !_has) setState(() { _loading = true; _error = null; });
    try {
      final d = await widget.load();
      if (mounted) setState(() { _data = d; _has = true; _loading = false; _error = null; _offline = false; });
    } catch (e) {
      if (mounted) setState(() { _error = errText(e); _offline = isOffline(e); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    const physics = AlwaysScrollableScrollPhysics();
    if (_loading) return ListView(padding: widget.padding, physics: physics, children: [SkeletonList(count: widget.skeletons)]);
    if (!_has) {
      return RefreshIndicator(onRefresh: reload, child: ListView(physics: physics, children: [SizedBox(height: 420, child: ErrorState(message: _error ?? 'Please try again.', onRetry: reload))]));
    }
    final d = _data as T;
    final banner = _error == null ? <Widget>[] : [InlineBanner(_offline ? 'You appear to be offline. Showing your last saved view.' : _error!, action: 'Retry', onAction: reload)];
    if (widget.isEmpty?.call(d) ?? false) {
      return RefreshIndicator(onRefresh: reload, child: ListView(padding: widget.padding, physics: physics, children: [...banner, SizedBox(height: 380, child: widget.empty ?? const SizedBox.shrink())]));
    }
    return RefreshIndicator(onRefresh: reload, child: ListView(padding: widget.padding, physics: physics, children: [...banner, ...widget.builder(context, d, reload)]));
  }
}
