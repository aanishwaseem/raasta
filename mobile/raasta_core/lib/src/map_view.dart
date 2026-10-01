import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'theme.dart';

class MapPin {
  const MapPin(this.lat, this.lng, {required this.icon, this.color = raastaTeal, this.label});
  final double lat;
  final double lng;
  final IconData icon;
  final Color color;
  final String? label;
}

/// OpenStreetMap tiles via flutter_map (no API key). Tiles need internet; pins and route still render without them.
/// For production traffic use your own tile server or a paid provider: the public OSM tile servers have a usage policy.
class MapView extends StatelessWidget {
  const MapView({super.key, required this.pins, this.route = const [], this.height = 260, this.tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'});
  final List<MapPin> pins;
  final List<List<double>> route;
  final double height;
  final String tileUrl;

  @override
  Widget build(BuildContext context) {
    final pts = [for (final p in pins) LatLng(p.lat, p.lng), for (final r in route) LatLng(r[0], r[1])];
    final fit = pts.length > 1 ? CameraFit.coordinates(coordinates: pts, padding: const EdgeInsets.all(40), maxZoom: 16) : null;
    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: FlutterMap(
          key: ValueKey('${pts.length}-${pts.isEmpty ? 0 : pts.first.latitude}-${pts.isEmpty ? 0 : pts.last.longitude}'),
          options: MapOptions(initialCenter: pts.isEmpty ? const LatLng(31.5204, 74.3587) : pts.first, initialZoom: 14, initialCameraFit: fit, interactionOptions: const InteractionOptions(flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag)),
          children: [
            TileLayer(urlTemplate: tileUrl, userAgentPackageName: 'pk.raasta.app'),
            if (route.length > 1) PolylineLayer(polylines: [Polyline(points: [for (final r in route) LatLng(r[0], r[1])], strokeWidth: 4, color: raastaTeal)]),
            MarkerLayer(markers: [
              for (final p in pins)
                Marker(point: LatLng(p.lat, p.lng), width: 40, height: 40, child: Tooltip(message: p.label ?? '', child: Icon(p.icon, color: p.color, size: 34))),
            ]),
            const SimpleAttributionWidget(source: Text('OpenStreetMap contributors')),
          ],
        ),
      ),
    );
  }
}
