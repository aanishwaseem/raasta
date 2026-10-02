import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:raasta_core/raasta_core.dart';

const _tileUrl = String.fromEnvironment('TILE_URL', defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');

/// A translucent circle on the map, e.g. a demand zone. [radiusM] is in metres.
class MapCircle {
  const MapCircle(this.lat, this.lng, this.radiusM, this.color);
  final double lat;
  final double lng;
  final double radiusM;
  final Color color;
}

/// Dark, full-bleed map for the driver app. Follows the driver and refits when [fitKey] changes
/// (a new trip phase). Pins reuse the shared [MapPin] type from the design kit.
class DriverMap extends StatefulWidget {
  const DriverMap({super.key, required this.center, this.pins = const [], this.route = const [], this.circles = const [], this.fitKey, this.follow = true, this.attribution = true, this.zoom = 15, this.fitPadding = const EdgeInsets.fromLTRB(48, 160, 48, 340)});
  final LatLng center;
  final List<MapPin> pins;
  final List<LatLng> route;
  final List<MapCircle> circles;
  final String? fitKey;
  final bool follow;

  /// Small map credit in the corner. Full-screen maps behind a bottom sheet turn it off and credit OSM on the Profile tab.
  final bool attribution;
  final double zoom;
  final EdgeInsets fitPadding;

  @override
  State<DriverMap> createState() => _DriverMapState();
}

class _DriverMapState extends State<DriverMap> {
  final _controller = MapController();
  bool _ready = false;

  @override
  void didUpdateWidget(DriverMap old) {
    super.didUpdateWidget(old);
    if (widget.fitKey != old.fitKey) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _fit());
    } else if (widget.follow && widget.center != old.center) {
      _move();
    }
  }

  void _fit() {
    if (!_ready || !mounted) return;
    final pts = [widget.center, for (final p in widget.pins) LatLng(p.lat, p.lng), ...widget.route];
    try {
      if (pts.length > 1) {
        _controller.fitCamera(CameraFit.coordinates(coordinates: pts, padding: widget.fitPadding, maxZoom: 16));
      } else {
        _controller.move(widget.center, widget.zoom);
      }
    } catch (_) {/* camera not attached yet */}
  }

  void _move() {
    if (!_ready) return;
    try {
      _controller.move(widget.center, _controller.camera.zoom);
    } catch (_) {/* camera not attached yet */}
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Inverts and dims the light OpenStreetMap tiles so the map matches the dark driver theme.
  static const _dim = ColorFilter.matrix([-0.82, 0, 0, 0, 212, 0, -0.82, 0, 0, 212, 0, 0, -0.82, 0, 212, 0, 0, 0, 1, 0]);

  @override
  Widget build(BuildContext context) {
    final surface = Theme.of(context).colorScheme.surface;
    return FlutterMap(
      mapController: _controller,
      options: MapOptions(
        initialCenter: widget.center,
        initialZoom: widget.zoom,
        onMapReady: () {
          _ready = true;
          if (widget.fitKey != null) _fit();
        },
        interactionOptions: const InteractionOptions(flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag | InteractiveFlag.doubleTapZoom),
      ),
      children: [
        ColorFiltered(colorFilter: _dim, child: TileLayer(urlTemplate: _tileUrl, userAgentPackageName: 'pk.raasta.app')),
        if (widget.circles.isNotEmpty)
          CircleLayer(circles: [
            for (final c in widget.circles) CircleMarker(point: LatLng(c.lat, c.lng), radius: c.radiusM, useRadiusInMeter: true, color: c.color.withValues(alpha: 0.28), borderColor: c.color, borderStrokeWidth: 2),
          ]),
        if (widget.route.length > 1) PolylineLayer(polylines: [Polyline(points: widget.route, strokeWidth: 6, color: Theme.of(context).colorScheme.primary)]),
        MarkerLayer(markers: [
          for (final p in widget.pins)
            Marker(
              point: LatLng(p.lat, p.lng),
              width: 48,
              height: 48,
              child: Tooltip(message: p.label ?? '', child: DecoratedBox(decoration: BoxDecoration(color: surface, shape: BoxShape.circle, border: Border.all(color: p.color, width: 2)), child: Icon(p.icon, color: p.color, size: 26))),
            ),
          Marker(point: widget.center, width: 26, height: 26, child: DecoratedBox(decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3)))),
        ]),
        if (widget.attribution) const _Credit(),
      ],
    );
  }
}

class _Credit extends StatelessWidget {
  const _Credit();
  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.bottomLeft,
        child: Container(margin: const EdgeInsets.all(4), padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2), color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.8), child: const Text('© OpenStreetMap', style: TextStyle(fontSize: 10))),
      );
}
