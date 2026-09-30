import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';
import { MetricsService } from '../metrics/metrics.service';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  constructor(private readonly metrics?: MetricsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = (req.id as string | undefined) ?? undefined;
    const { status, body } = toErrorBody(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        { err: exception instanceof Error ? { message: exception.message, stack: exception.stack } : exception, requestId, path: req.url },
        'Unhandled error',
      );
    }
    this.metrics?.failedRequests.inc({ status: String(status), code: body.error.code });
    res.status(status).json(body);
  }
}

export function toErrorBody(exception: unknown, requestId?: string): { status: number; body: ErrorBody } {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: { error: { code: exception.code, message: exception.message, details: exception.details, requestId } },
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse() as string | { message?: string | string[]; error?: string };
    let message = exception.message;
    let details: unknown;
    if (typeof response === 'object' && response && Array.isArray(response.message)) {
      message = 'Some fields are invalid';
      details = { fields: response.message };
    } else if (typeof response === 'object' && response && typeof response.message === 'string') {
      message = response.message;
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) message = 'Too many attempts. Please wait a moment and try again.';
    return { status, body: { error: { code: STATUS_CODES[status] ?? 'ERROR', message, details, requestId } } };
  }
  const pgCode = (exception as { code?: string })?.code;
  if (pgCode === '23505') {
    return {
      status: HttpStatus.CONFLICT,
      body: { error: { code: 'CONFLICT', message: 'This record already exists', requestId } },
    };
  }
  if (pgCode === '22P02' || pgCode === '23514') {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: { error: { code: 'VALIDATION_FAILED', message: 'Some fields are invalid', requestId } },
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', requestId } },
  };
}
