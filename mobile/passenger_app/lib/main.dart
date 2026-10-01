import 'package:flutter/material.dart';
import 'package:raasta_core/raasta_core.dart';

import 'screens/home_screen.dart';

const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000/api/v1');

void main() => runApp(PassengerApp(api: ApiClient(baseUrl: apiUrl)));

class PassengerApp extends StatefulWidget {
  PassengerApp({super.key, required this.api, DeviceLocation? location}) : location = location ?? DeviceLocation();
  final ApiClient api;
  final DeviceLocation location;

  @override
  State<PassengerApp> createState() => _PassengerAppState();
}

class _PassengerAppState extends State<PassengerApp> {
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
      title: 'Raasta',
      theme: raastaTheme(),
      darkTheme: raastaTheme(brightness: Brightness.dark),
      debugShowCheckedModeBanner: false,
      home: !_ready
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : widget.api.session == null
              ? LoginScreen(api: widget.api, role: 'PASSENGER', title: 'Get a ride', onLoggedIn: () => setState(() {}))
              : HomeScreen(api: widget.api, location: widget.location, onSignOut: () async { await widget.api.logout(); setState(() {}); }),
    );
  }
}
