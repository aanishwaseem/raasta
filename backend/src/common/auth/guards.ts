import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { RedisService } from '../redis/redis.service';
import type { AuthUser, Role } from './auth.types';
import { IS_PUBLIC, ROLES_KEY } from './decorators';
import { verifyAccessToken } from './jwt';

export const revokedSessionKey = (sid: string) => `session:revoked:${sid}`;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      if (isPublic) return true;
      throw AppError.unauthenticated();
    }
    try {
      const user = await verifyAccessToken(header.slice(7));
      if (await this.redis.client.exists(revokedSessionKey(user.sid))) throw AppError.unauthenticated('This session was signed out');
      req.user = user;
    } catch (err) {
      if (isPublic) return true; // optional auth on public routes
      throw err;
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !roles.some((r) => user.roles.includes(r))) throw AppError.forbidden();
    return true;
  }
}
