import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../../config/config';

/**
 * Redis usage (all keys city-scoped where relevant so a city can later be sharded):
 *  drivers:geo:{cityId}         GEO set of online drivers
 *  driver:presence:{driverId}   hash {cityId, status: IDLE|OFFERED|ON_TRIP, vehicleClass, ...} with TTL
 *  ride:lock:{rideId}           assignment lock
 *  ratelimit:*                  fixed-window counters
 *  session:revoked:{sid}        revoked session ids until access token expiry
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private readonly created = new Set<Redis>();

  constructor() {
    this.client = this.create('main');
  }

  create(name: string): Redis {
    const c = new Redis(config().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false, connectionName: `raasta-${name}` });
    c.on('error', (err) => this.logger.warn(`Redis(${name}) error: ${err.message}`));
    this.created.add(c);
    return c;
  }

  /** Acquire a short-lived lock. Returns a release function, or null if already held. */
  /** `ttlMs` is milliseconds. */
  async lock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const token = Math.random().toString(36).slice(2);
    const ok = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return null;
    return async () => {
      await this.client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      );
    };
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const c of this.created) c.disconnect();
    this.created.clear();
  }
}
