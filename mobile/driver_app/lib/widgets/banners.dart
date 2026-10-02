import 'package:flutter/material.dart';

import '../util.dart';

/// Slim banner for problems the driver can act on: network lost, GPS off, permission denied.
class ProblemBanner extends StatelessWidget {
  const ProblemBanner({super.key, required this.icon, required this.message, this.actionLabel, this.onAction, this.color = raastaWarn});
  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF1B1F23),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        constraints: const BoxConstraints(minHeight: 56),
        padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), border: Border.all(color: color, width: 1.5)),
        child: Row(children: [
          Icon(icon, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white))),
          if (actionLabel != null) TextButton(style: TextButton.styleFrom(minimumSize: const Size(64, 48)), onPressed: onAction, child: Text(actionLabel!)),
        ]),
      ),
    );
  }
}

const raastaWarn = Color(0xFFF59E0B);

/// Shown while requests are failing because there is no connection.
class NetworkBanner extends StatelessWidget {
  const NetworkBanner({super.key, required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => ProblemBanner(icon: Icons.wifi_off, message: 'No connection. Reconnecting…', actionLabel: 'Retry', onAction: onRetry);
}

/// Shown when the device location is unavailable (GPS off or permission denied).
class GpsBanner extends StatelessWidget {
  const GpsBanner({super.key, required this.problem, required this.onRetry});
  final String problem;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => ProblemBanner(icon: Icons.location_off, message: problem, actionLabel: 'Retry', onAction: onRetry, color: sosRed);
}
