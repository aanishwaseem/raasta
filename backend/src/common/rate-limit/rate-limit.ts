import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { RedisService } from '../redis/redis.service';
import type { AuthUser } from '../auth/auth.types';

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSec: number;
  /** what identifies the caller: ip, authenticated user, or a request body field (e.g. phone) */
  by: 'ip' | 'user' | `body:${string}`;
}

const RATE_LIMITS = 'rateLimits';
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMITS, rules);

const DEFAULT_RULE: RateLimitRule = { name: 'global', limit: 120, windowSec: 60, by: 'user' };

/** Fixed-window limiter backed by Redis so limits hold across API replicas. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMITS, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const req = ctx.switchToHttp().getRequest<{ ip?: string; user?: AuthUser; body?: Record<string, unknown> }>();
    const res = ctx.switchToHttp().getResponse<Response>();

    for (const rule of [DEFAULT_RULE, ...rules]) {
      const subject = this.subject(rule, req);
      if (!subject) continue;
      const bucket = Math.floor(Date.now() / 1000 / rule.windowSec);
      const key = `ratelimit:${rule.name}:${subject}:${bucket}`;
      const count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, rule.windowSec + 1);
      if (count > rule.limit) {
        const retryAfter = rule.windowSec - (Math.floor(Date.now() / 1000) % rule.windowSec);
        res.setHeader('Retry-After', String(retryAfter));
        throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    return true;
  }

  private subject(rule: RateLimitRule, req: { ip?: string; user?: AuthUser; body?: Record<string, unknown> }): string | null {
    if (rule.by === 'ip') return req.ip ?? 'unknown';
    if (rule.by === 'user') return req.user ? `u:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
    const field = rule.by.slice(5);
    const v = req.body?.[field];
    return typeof v === 'string' && v ? v.toLowerCase().replace(/\s+/g, '') : null;
  }
}
