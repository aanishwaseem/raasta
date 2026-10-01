import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, lastValueFrom, Observable, of } from 'rxjs';
import { DatabaseService } from '../db/database.service';
import { AppError } from '../errors/app-error';
import { sha256 } from '../crypto/crypto';
import type { AuthUser } from '../auth/auth.types';

const IDEMPOTENT = 'idempotent';
export interface IdempotentOptions {
  scope: string;
  required: boolean;
}
/** Marks a POST as idempotent via the Idempotency-Key header. */
export const Idempotent = (scope: string, required = true) => SetMetadata(IDEMPOTENT, { scope, required } satisfies IdempotentOptions);

/**
 * Stores the first successful response per (user, scope, key). Retries with the same key and body replay it;
 * the same key with a different body is rejected; a concurrent duplicate gets 409 while the first is in flight.
 * Failed requests release the key so the client can retry.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const opts = this.reflector.get<IdempotentOptions | undefined>(IDEMPOTENT, ctx.getHandler());
    if (!opts) return next.handle();
    return from(this.handle(ctx, next, opts));
  }

  private async handle(ctx: ExecutionContext, next: CallHandler, opts: IdempotentOptions): Promise<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (!key) {
      if (opts.required) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', HttpStatus.BAD_REQUEST);
      return lastValueFrom(next.handle());
    }
    if (key.length > 128) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is too long', HttpStatus.BAD_REQUEST);
    const userId = req.user?.id;
    if (!userId) return lastValueFrom(next.handle());
    const requestHash = sha256(JSON.stringify({ path: req.path, body: req.body ?? null }));

    const inserted = await this.db.one<{ key: string }>(
      `INSERT INTO idempotency_keys (user_id, key, scope, request_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING RETURNING key`,
      [userId, key, opts.scope, requestHash],
    );
    if (!inserted) {
      const existing = await this.db.one<{ request_hash: string; status: string; response: unknown; status_code: number }>(
        `SELECT request_hash, status, response, status_code FROM idempotency_keys WHERE user_id=$1 AND scope=$2 AND key=$3`,
        [userId, opts.scope, key],
      );
      if (!existing) return lastValueFrom(next.handle());
      if (existing.request_hash !== requestHash) {
        throw AppError.conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      }
      if (existing.status === 'IN_PROGRESS') {
        throw AppError.conflict('REQUEST_IN_PROGRESS', 'The same request is already being processed');
      }
      res.status(existing.status_code);
      res.setHeader('Idempotent-Replay', 'true');
      return lastValueFrom(of(existing.response));
    }

    try {
      const result = await lastValueFrom(next.handle());
      await this.db.query(
        `UPDATE idempotency_keys SET status='COMPLETED', response=$4, status_code=$5 WHERE user_id=$1 AND scope=$2 AND key=$3`,
        [userId, opts.scope, key, JSON.stringify(result ?? null), res.statusCode || 201],
      );
      return result;
    } catch (err) {
      await this.db.query(`DELETE FROM idempotency_keys WHERE user_id=$1 AND scope=$2 AND key=$3`, [userId, opts.scope, key]);
      throw err;
    }
  }
}
