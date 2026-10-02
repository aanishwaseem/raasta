import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import 'activity/activity_screen.dart';
import 'home/home_screen.dart';
import 'profile/profile_screen.dart';
import 'safety/safety_screen.dart';
import 'wallet/wallet_screen.dart';

/// Five-tab shell. Tabs keep their state; each tab is built the first time it is opened.
class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.api, required this.location, required this.onSignOut});
  final ApiClient api;
  final DeviceLocation location;
  final Future<void> Function() onSignOut;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;
  final _visited = <int>{0};

  Widget _page(int i) => switch (i) {
        0 => HomeScreen(api: widget.api, location: widget.location),
        1 => ActivityScreen(api: widget.api, location: widget.location),
        2 => WalletScreen(api: widget.api),
        3 => SafetyScreen(api: widget.api, location: widget.location),
        _ => ProfileScreen(api: widget.api, location: widget.location, onSignOut: widget.onSignOut),
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: [for (var i = 0; i < 5; i++) _visited.contains(i) ? _page(i) : const SizedBox.shrink()]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() { _index = i; _visited.add(i); }),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Activity'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'Wallet'),
          NavigationDestination(icon: Icon(Icons.shield_outlined), selectedIcon: Icon(Icons.shield), label: 'Safety'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
