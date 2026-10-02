import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { RedisService } from '../redis/redis.service';
import type { AuthUser } from '../auth/auth.types';
import { normalizePkPhone } from '../crypto/crypto';

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSec: number;
  /** what identifies the caller: ip, authenticated user, or a request body field (e.g. phone) */
  by: 'ip' | 'user' | `body:${string}`;
}

const RATE_LIMITS = 'rateLimits';
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMITS, rules);

/** Atomic INCR + EXPIRE: a crash between the two calls can never leave a counter without a TTL (permanent lockout). */
const INCR_WITH_TTL = `local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return c`;

/**
 * Canonical form of an identifier used as a rate-limit / lockout key, so "0300 1234567", "+923001234567"
 * and "Bilal@X.com " / "bilal@x.com" cannot be used to dodge a per-account limit.
 */
export function canonicalSubject(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v.includes('@')) return v;
  return normalizePkPhone(v) ?? v.replace(/\s+/g, '');
}

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
      const count = Number(await this.redis.client.eval(INCR_WITH_TTL, 1, key, String(rule.windowSec + 1)));
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
    return typeof v === 'string' && v ? canonicalSubject(v.slice(0, 254)) : null;
  }
}
