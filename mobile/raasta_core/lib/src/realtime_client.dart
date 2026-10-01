import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

/// Pushes "something changed" signals from the backend's /realtime socket.
///
/// The screens still poll as a safety net; a signal here just makes them
/// refresh immediately instead of waiting for the next poll tick.
class RealtimeClient {
  RealtimeClient({required this.url, required this.tokenProvider, this.rideId});

  /// API origin, e.g. http://localhost:3000 (no path).
  final String url;
  final String? Function() tokenProvider;
  final String? rideId;

  io.Socket? _socket;
  final _events = StreamController<String>.broadcast();

  Stream<String> get events => _events.stream;
  bool get connected => _socket?.connected ?? false;

  static const watched = [
    'ride.requested', 'ride.matching', 'ride.offer', 'ride.offer_expired', 'ride.driver_assigned',
    'ride.driver_arriving', 'ride.driver_arrived', 'ride.started', 'ride.location_updated',
    'ride.completed', 'ride.cancelled', 'ride.no_drivers', 'ride.updated', 'payment.updated',
  ];

  void connect() {
    if (_socket != null) return;
    final s = _socket = io.io(
      '$url/realtime',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .setAuth({'token': tokenProvider() ?? ''})
          .setReconnectionDelay(2000)
          .build(),
    );
    s.onConnect((_) {
      final id = rideId;
      if (id != null) s.emitWithAck('ride.subscribe', {'rideId': id}, ack: (_) {});
    });
    // refresh the token on every reconnect attempt
    s.io.on('reconnect_attempt', (_) => s.auth = {'token': tokenProvider() ?? ''});
    for (final e in watched) {
      s.on(e, (_) => _events.add(e));
    }
    s.connect();
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
    _events.close();
  }
}
