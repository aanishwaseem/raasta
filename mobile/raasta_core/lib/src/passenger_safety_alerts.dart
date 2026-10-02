import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import 'api_client.dart';

/// Push feed of safety prompts (route deviation, trip ended away from destination) for a rider.
///
/// The ride snapshot has no field for these, so the rider app listens to the realtime socket
/// directly. Each alert is the server payload: eventId, rideId, type, severity, message, detail, actions.
class SafetyAlertFeed {
  SafetyAlertFeed._(this._socket, this._controller);

  final io.Socket _socket;
  final StreamController<Map<String, dynamic>> _controller;
  final _seen = <String>{};

  Stream<Map<String, dynamic>> get alerts => _controller.stream;

  /// Returns null when the API client runs without realtime (tests, offline builds).
  static SafetyAlertFeed? connect(ApiClient api) {
    if (!api.useRealtime) return null;
    final u = Uri.parse(api.baseUrl);
    final origin = '${u.scheme}://${u.host}${u.hasPort ? ':${u.port}' : ''}';
    final socket = io.io(
      '$origin/realtime',
      io.OptionBuilder().setTransports(['websocket']).disableAutoConnect().setAuth({'token': api.session?.accessToken ?? ''}).setReconnectionDelay(3000).build(),
    );
    final feed = SafetyAlertFeed._(socket, StreamController<Map<String, dynamic>>.broadcast());
    socket.io.on('reconnect_attempt', (_) => socket.auth = {'token': api.session?.accessToken ?? ''});
    for (final e in const ['safety.alert', 'ride.route_deviation']) {
      socket.on(e, (data) {
        if (data is! Map) return;
        final m = Map<String, dynamic>.from(data);
        final id = m['eventId'];
        if (id is String && !feed._seen.add(id)) return;
        // Updates sent to ops ("CONFIRMED_SAFE") carry no message; only show real prompts.
        if (m['message'] == null) return;
        if (!feed._controller.isClosed) feed._controller.add(m);
      });
    }
    socket.connect();
    return feed;
  }

  void dispose() {
    _socket.dispose();
    _controller.close();
  }
}
