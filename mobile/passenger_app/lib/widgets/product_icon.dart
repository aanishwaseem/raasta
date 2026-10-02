import 'package:flutter/material.dart';

IconData productIcon(String code, [String? vehicleClass]) {
  final c = '$code ${vehicleClass ?? ''}'.toUpperCase();
  if (c.contains('BIKE') || c.contains('MOTO')) return Icons.two_wheeler;
  if (c.contains('RICKSHAW') || c.contains('AUTO')) return Icons.electric_rickshaw;
  if (c.contains('SHARED') || c.contains('POOL')) return Icons.people_alt_outlined;
  if (c.contains('PREMIUM') || c.contains('LUX')) return Icons.workspace_premium_outlined;
  if (c.contains('XL') || c.contains('VAN')) return Icons.airport_shuttle_outlined;
  if (c.contains('COMFORT')) return Icons.airline_seat_recline_extra;
  return Icons.directions_car_filled_outlined;
}

const productBlurbs = {
  'BIKE': 'Fastest through traffic',
  'ECONOMY': 'Everyday low fares',
  'COMFORT': 'Newer cars, extra room',
  'PREMIUM': 'Top-rated drivers, premium cars',
  'XL': 'Up to 6 seats',
  'SHARED': 'Share the ride, split the fare',
};
