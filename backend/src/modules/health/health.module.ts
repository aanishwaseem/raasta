import { Controller, Get, Header, Headers, Module, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { config } from '../../config/config';
import { AppError } from '../../common/errors/app-error';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { DatabaseService } from '../../common/db/database.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { RedisService } from '../../common/redis/redis.service';
import { AiClient } from '../ai/ai.client';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly ai: AiClient,
    private readonly metrics: MetricsService,
  ) {}

  /** Liveness: the process is up. */
  @Public()
  @Get('health')
  live() {
    return { status: 'ok', uptimeS: Math.round(process.uptime()) };
  }

  /** Readiness: hard dependencies must be reachable; the AI service is optional (local fallbacks exist). */
  @Public()
  @Get('health/ready')
  async ready() {
    const [db, redis, ai] = await Promise.all([this.db.ping().catch(() => false), this.redis.ping().catch(() => false), this.ai.health().catch(() => false)]);
    const body = { status: db && redis ? 'ready' : 'degraded', checks: { postgres: db, redis, aiService: ai ? 'up' : 'down (using fallbacks)' } };
    if (!db || !redis) throw new ServiceUnavailableException(body);
    return body;
  }

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metricsText(@Headers('authorization') authorization?: string) {
    // Prometheus must send `Authorization: Bearer <METRICS_TOKEN>`; metrics expose route names, volumes and failure rates.
    const given = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
    const expected = Buffer.from(config().METRICS_TOKEN);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw AppError.unauthenticated();
    return this.metrics.registry.metrics();
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
