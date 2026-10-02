import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { decodeJwt } from 'jose';
import type { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../../common/auth/jwt';
import { revokedSessionKey } from '../../common/auth/guards';
import { RedisService } from '../../common/redis/redis.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthUser } from '../../common/auth/auth.types';
import { config, corsOrigins } from '../../config/config';
import { RealtimeService } from './realtime.service';

const CLIENT_EVENTS = ['ride.subscribe', 'ride.unsubscribe', 'driver.location', 'ping'] as const;

/** Per-socket flood control: this many client events per window, disconnect at HARD_FACTOR times that. */
export const SOCKET_EVENT_LIMIT = 60;
export const SOCKET_EVENT_WINDOW_MS = 10_000;
const SOCKET_HARD_FACTOR = 3;
const MAX_RIDE_ROOMS = 20;
const SESSION_RECHECK_MS = 30_000;

/**
 * Fixed-window event counter used per socket. Pure so it can be unit tested.
 * Returns 'ok', 'limited' (drop the event) or 'abusive' (disconnect).
 */
export class SocketRateLimiter {
  private windowStart = 0;
  private count = 0;
  constructor(
    private readonly limit = SOCKET_EVENT_LIMIT,
    private readonly windowMs = SOCKET_EVENT_WINDOW_MS,
  ) {}
  hit(now = Date.now()): 'ok' | 'limited' | 'abusive' {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count++;
    if (this.count > this.limit * SOCKET_HARD_FACTOR) return 'abusive';
    return this.count > this.limit ? 'limited' : 'ok';
  }
}

@WebSocketGateway({
  namespace: '/realtime',
  // same allowlist as the REST API; native apps send no Origin header and are unaffected. Auth is a bearer token in the
  // handshake (never a cookie), so cross-site WebSocket hijacking has nothing to ride on.
  cors: { origin: corsOrigins(config()), credentials: false },
  pingInterval: 20000,
  pingTimeout: 20000,
  maxHttpBufferSize: 16 * 1024,
})
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
        socket.data.exp = (decodeJwt(token).exp ?? 0) * 1000;
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
    // A socket must not outlive its access token or a revoked session: close it at expiry (clients reconnect with a fresh
    // token, see raasta_core RealtimeClient) and re-check revocation periodically.
    const exp = socket.data.exp as number;
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, exp - Date.now()));
    const recheck = setInterval(() => {
      void this.redis.client.exists(revokedSessionKey(user.sid)).then((revoked) => {
        if (revoked) socket.disconnect(true);
      });
    }, SESSION_RECHECK_MS);
    const limiter = new SocketRateLimiter();
    socket.once('disconnect', () => {
      clearTimeout(expiry);
      clearInterval(recheck);
    });
    if (user.roles.includes('ADMIN') || user.roles.includes('SUPPORT')) void socket.join('ops');
    this.metrics.socketConnections.inc({ role: primaryRole(user) });

    for (const event of CLIENT_EVENTS) {
      socket.on(event, async (payload: unknown, ack?: (res: unknown) => void) => {
        try {
          const verdict = limiter.hit();
          if (verdict === 'abusive') {
            socket.disconnect(true);
            return;
          }
          if (verdict === 'limited') throw new AppError('RATE_LIMITED', 'Too many messages. Slow down.', 429);
          if (Date.now() >= exp) {
            socket.disconnect(true);
            return;
          }
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
              const joined = [...socket.rooms].filter((r) => r.startsWith('ride:')).length;
              if (joined >= MAX_RIDE_ROOMS && !socket.rooms.has(`ride:${rideId}`) && !user.roles.includes('ADMIN') && !user.roles.includes('SUPPORT')) {
                throw new AppError('LIMIT_REACHED', 'Too many ride subscriptions');
              }
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
