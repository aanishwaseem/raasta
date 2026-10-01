import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

/// MapView stretched to fill its parent edge to edge (MapView clips its own corners, so it is drawn slightly oversized).
class FullBleedMap extends StatelessWidget {
  const FullBleedMap({super.key, required this.pins, this.route = const []});
  final List<MapPin> pins;
  final List<List<double>> route;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final w = c.maxWidth.isFinite ? c.maxWidth : MediaQuery.of(context).size.width;
      final h = c.maxHeight.isFinite ? c.maxHeight : MediaQuery.of(context).size.height;
      return ClipRect(
        child: OverflowBox(
          minWidth: w + 32, maxWidth: w + 32, minHeight: h + 32, maxHeight: h + 32,
          child: MapView(height: h + 32, pins: pins, route: route),
        ),
      );
    });
  }
}
