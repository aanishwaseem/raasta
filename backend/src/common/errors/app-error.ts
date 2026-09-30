import { HttpStatus } from '@nestjs/common';

/**
 * Domain error with a stable machine code and a user-safe message.
 * The HTTP filter renders it as { error: { code, message, details, requestId } }.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  static notFound(what: string, code = 'NOT_FOUND') {
    return new AppError(code, `${what} not found`, HttpStatus.NOT_FOUND);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }
  static conflict(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }
  static unprocessable(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
  static unauthenticated(message = 'Please sign in again', code = 'UNAUTHENTICATED') {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED);
  }
  static invalidTransition(from: string, to: string) {
    return new AppError('INVALID_STATE_TRANSITION', `This ride can no longer move from ${from} to ${to}`, HttpStatus.CONFLICT, {
      from,
      to,
    });
  }
}
