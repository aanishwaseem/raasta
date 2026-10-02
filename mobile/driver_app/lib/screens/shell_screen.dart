import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import 'demand_screen.dart';
import 'drive_screen.dart';
import 'earnings_screen.dart';
import 'profile_screen.dart';
import 'wallet_screen.dart';

/// The approved driver's home: five tabs, kept alive once opened so the map and online state survive switching.
class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key, required this.api, required this.location, required this.onSignOut});
  final ApiClient api;
  final DeviceLocation location;
  final VoidCallback onSignOut;

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  int _index = 0;
  final _opened = {0};

  Widget _tab(int i) => switch (i) {
        0 => DriveScreen(api: widget.api, location: widget.location),
        1 => EarningsScreen(api: widget.api),
        2 => DemandScreen(api: widget.api, location: widget.location),
        3 => WalletScreen(api: widget.api),
        _ => ProfileScreen(api: widget.api, onSignOut: widget.onSignOut),
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: [for (var i = 0; i < 5; i++) _opened.contains(i) ? _tab(i) : const SizedBox.shrink()]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() { _index = i; _opened.add(i); }),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.navigation_outlined), selectedIcon: Icon(Icons.navigation), label: 'Drive'),
          NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart), label: 'Earnings'),
          NavigationDestination(icon: Icon(Icons.local_fire_department_outlined), selectedIcon: Icon(Icons.local_fire_department), label: 'Demand'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'Wallet'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
