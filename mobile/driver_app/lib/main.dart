import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import 'screens/gate_screen.dart';

const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000/api/v1');

void main() => runApp(DriverApp(api: ApiClient(baseUrl: apiUrl, useRealtime: true)));

class DriverApp extends StatefulWidget {
  DriverApp({super.key, required this.api, DeviceLocation? location}) : location = location ?? DeviceLocation();
  final ApiClient api;
  final DeviceLocation location;

  @override
  State<DriverApp> createState() => _DriverAppState();
}

class _DriverAppState extends State<DriverApp> {
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    widget.api.restore().then((_) => setState(() => _ready = true));
    widget.api.onLoggedOut.listen((_) => setState(() {}));
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Raasta Driver',
      theme: raastaTheme(minButtonHeight: 56),
      darkTheme: raastaTheme(brightness: Brightness.dark, minButtonHeight: 56),
      debugShowCheckedModeBanner: false,
      home: !_ready
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : widget.api.session == null
              ? LoginScreen(api: widget.api, role: 'DRIVER', title: 'Drive with Raasta', onLoggedIn: () => setState(() {}))
              : GateScreen(api: widget.api, location: widget.location, onSignOut: () async { await widget.api.logout(); setState(() {}); }),
    );
  }
}
