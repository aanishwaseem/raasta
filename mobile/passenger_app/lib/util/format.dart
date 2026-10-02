const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

DateTime? parseTime(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

String two(int n) => n.toString().padLeft(2, '0');

String clock(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${two(d.minute)} ${d.hour < 12 ? 'AM' : 'PM'}';
}

String dayLabel(DateTime d, {DateTime? now}) {
  final n = now ?? DateTime.now();
  final a = DateTime(d.year, d.month, d.day);
  final b = DateTime(n.year, n.month, n.day);
  final diff = a.difference(b).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Tomorrow';
  if (diff == -1) return 'Yesterday';
  return '${d.day} ${_months[d.month - 1]}';
}

/// "Today, 5:30 PM" or "12 Oct, 5:30 PM"; empty text for missing values.
String whenText(Object? iso) {
  final d = parseTime(iso);
  return d == null ? '' : '${dayLabel(d)}, ${clock(d)}';
}

String shortDate(Object? iso) {
  final d = parseTime(iso);
  return d == null ? '' : '${d.day} ${_months[d.month - 1]} ${d.year}';
}

/// First part of an address, for compact labels.
String shortAddress(Object? a, {int parts = 2}) => a is String && a.isNotEmpty ? a.split(',').take(parts).join(',').trim() : 'Selected place';

String firstName(String? full) {
  final f = (full ?? '').trim().split(RegExp(r'\s+')).first;
  return f;
}

String greeting([DateTime? now]) {
  final h = (now ?? DateTime.now()).hour;
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

String upper1(String s) => s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1).toLowerCase()}';

String humanize(String s) => s.split('_').map(upper1).join(' ');

/// "PKR 1,234.50" style amounts are whole rupees in this API; this formats seconds as "4 min".
String etaText(num? seconds) => seconds == null ? '' : seconds < 60 ? '<1 min' : '${(seconds / 60).round()} min';
