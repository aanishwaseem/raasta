String money(num? v) => v == null ? '–' : 'Rs ${v.round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',')}';

String km(num? meters) => meters == null ? '–' : '${(meters / 1000).toStringAsFixed(1)} km';

String minutes(num? seconds) => seconds == null ? '–' : '${(seconds / 60).ceil()} min';

String prettyStatus(String s) {
  final w = s.toLowerCase().split('_');
  return '${w.first[0].toUpperCase()}${w.first.substring(1)}${w.length > 1 ? ' ${w.skip(1).join(' ')}' : ''}';
}
