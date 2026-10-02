import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';

/** GET routes under /admin that return personal or financial data: reading them is audited too. */
const SENSITIVE_READS = [/\/admin\/(users|drivers|rides|payments|withdrawals|audit-logs)(\/|$)/, /\/admin\/wallets\//, /\/admin\/documents\//, /\/admin\/support\/tickets\/[^/]+$/];

export const isAuditedAdminRequest = (method: string, routePath: string): boolean =>
  /\/admin(\/|$)/.test(routePath) && (!['GET', 'HEAD', 'OPTIONS'].includes(method) || SENSITIVE_READS.some((r) => r.test(routePath)));

/**
 * Backstop for the admin back office: every state-changing /admin request and every read of personal or financial data is written to
 * the audit trail (who, what route, which ids, outcome status, IP, request id) even if a service method forgets to audit.
 * Request bodies are deliberately not stored here (they can hold PII); services record before/after where it matters.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AdminAudit');
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser; id?: string }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const routePath = (req.route?.path as string | undefined) ?? req.path;
    if (!req.user || !isAuditedAdminRequest(req.method, routePath)) return next.handle();
    res.once('finish', () => {
      this.audit
        .log({
          actor: req.user,
          action: `admin.http.${req.method.toLowerCase()}`,
          entityType: 'http_route',
          entityId: null,
          after: { route: routePath, params: req.params, queryKeys: Object.keys(req.query ?? {}), status: res.statusCode },
          meta: { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, requestId: req.id ?? null },
        })
        .catch((e: Error) => this.logger.error(`failed to write admin audit entry: ${e.message}`));
    });
    return next.handle();
  }
}
