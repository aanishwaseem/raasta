import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../../common/auth/jwt';
import { revokedSessionKey } from '../../common/auth/guards';
import { RedisService } from '../../common/redis/redis.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthUser } from '../../common/auth/auth.types';
import { RealtimeService } from './realtime.service';

const CLIENT_EVENTS = ['ride.subscribe', 'ride.unsubscribe', 'driver.location', 'ping'] as const;

@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: false }, pingInterval: 20000, pingTimeout: 20000 })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
    // authenticate during the handshake so unauthenticated sockets never connect
    server.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth?.token as string | undefined) ?? (socket.handshake.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!token) return next(new Error('UNAUTHENTICATED'));
        const user = await verifyAccessToken(token);
        if (await this.redis.client.exists(revokedSessionKey(user.sid))) return next(new Error('UNAUTHENTICATED'));
        socket.data.user = user;
        next();
      } catch (err) {
        next(new Error(err instanceof AppError ? err.code : 'UNAUTHENTICATED'));
      }
    });
  }

  handleConnection(socket: Socket) {
    const user = socket.data.user as AuthUser | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    void socket.join(`user:${user.id}`);
    if (user.roles.includes('ADMIN') || user.roles.includes('SUPPORT')) void socket.join('ops');
    this.metrics.socketConnections.inc({ role: primaryRole(user) });

    for (const event of CLIENT_EVENTS) {
      socket.on(event, async (payload: unknown, ack?: (res: unknown) => void) => {
        try {
          let result: unknown;
          if (event === 'ping') result = { pong: Date.now() };
          else if (event === 'ride.unsubscribe') {
            const rideId = (payload as { rideId?: string })?.rideId;
            if (rideId) await socket.leave(`ride:${rideId}`);
            result = { ok: true };
          } else {
            const handler = this.realtime.handlers.get(event);
            if (!handler) throw new AppError('NOT_SUPPORTED', 'Unsupported event');
            result = await handler(user, payload);
            if (event === 'ride.subscribe') {
              const rideId = (payload as { rideId: string }).rideId;
              await socket.join(`ride:${rideId}`); // handler throws if the user may not see the ride
            }
          }
          ack?.({ ok: true, data: result });
        } catch (err) {
          const e = err instanceof AppError ? { code: err.code, message: err.message } : { code: 'INTERNAL', message: 'Something went wrong' };
          if (!(err instanceof AppError)) this.logger.error(`Socket handler ${event} failed: ${(err as Error).message}`);
          ack?.({ ok: false, error: e });
        }
      });
    }
  }

  handleDisconnect(socket: Socket) {
    const user = socket.data.user as AuthUser | undefined;
    if (user) this.metrics.socketConnections.dec({ role: primaryRole(user) });
  }
}

const primaryRole = (u: AuthUser) => (u.roles.includes('DRIVER') ? 'DRIVER' : u.roles.includes('ADMIN') || u.roles.includes('SUPPORT') ? 'STAFF' : 'PASSENGER');
