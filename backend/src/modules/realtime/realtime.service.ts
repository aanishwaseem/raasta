import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { AuthUser } from '../../common/auth/auth.types';

/** Server → client event names (see SYSTEM_ARCHITECTURE.md §5). */
export type ServerEvent =
  | 'ride.requested'
  | 'ride.matching'
  | 'ride.offer'
  | 'ride.offer_expired'
  | 'ride.driver_assigned'
  | 'ride.driver_arriving'
  | 'ride.driver_arrived'
  | 'ride.started'
  | 'ride.location_updated'
  | 'ride.route_deviation'
  | 'ride.completed'
  | 'ride.cancelled'
  | 'ride.no_drivers'
  | 'ride.updated'
  | 'driver.online'
  | 'driver.offline'
  | 'driver.location_updated'
  | 'safety.alert'
  | 'payment.updated'
  | 'support.ticket_created'
  | 'support.ticket_reply'
  | 'fraud.event_created'
  | 'delivery.updated'
  | 'notification';

export type ClientHandler = (user: AuthUser, payload: unknown) => Promise<unknown>;

/**
 * Facade used by domain modules to push events. Domain modules register handlers for client → server
 * messages here, which keeps the gateway free of domain dependencies (no circular imports).
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;
  readonly handlers = new Map<string, ClientHandler>();

  attach(server: Server) {
    this.server = server;
  }

  registerHandler(event: string, handler: ClientHandler) {
    this.handlers.set(event, handler);
  }

  toUser(userId: string, event: ServerEvent, payload: unknown) {
    this.emit(`user:${userId}`, event, payload);
  }

  toRide(rideId: string, event: ServerEvent, payload: unknown) {
    this.emit(`ride:${rideId}`, event, payload);
  }

  toOps(event: ServerEvent, payload: unknown) {
    this.emit('ops', event, payload);
  }

  async joinUserToRide(userId: string, rideId: string) {
    if (!this.server) return;
    this.server.in(`user:${userId}`).socketsJoin(`ride:${rideId}`);
  }

  /** Revoke a user's live subscription (e.g. a driver who cancelled must not keep receiving the next driver's location). */
  async removeUserFromRide(userId: string, rideId: string) {
    if (!this.server) return;
    this.server.in(`user:${userId}`).socketsLeave(`ride:${rideId}`);
  }

  async connectionCount(): Promise<number> {
    if (!this.server) return 0;
    return (await this.server.fetchSockets()).length;
  }

  private emit(room: string, event: ServerEvent, payload: unknown) {
    if (!this.server) {
      this.logger.debug(`Realtime not attached; dropping ${event} to ${room}`);
      return;
    }
    this.server.to(room).emit(event, { ...(payload as object), _event: event, _at: new Date().toISOString() });
  }
}
