import type { LoggerService, LogLevel } from '@nestjs/common';

const RANK: Record<string, number> = { verbose: 0, debug: 1, log: 2, warn: 3, error: 4, fatal: 5 };
const NAME: Record<string, string> = { log: 'info', verbose: 'debug', fatal: 'fatal' };

/**
 * One JSON object per line on stdout/stderr, ready for Loki/CloudWatch/ELK. Nest's own logs and ours share the format,
 * so `jq 'select(.requestId=="...")'` follows a request across the access log and application logs.
 */
export class JsonLogger implements LoggerService {
  constructor(private readonly min: LogLevel = 'log') {}

  private write(level: string, message: unknown, context?: string, extra?: Record<string, unknown>) {
    if (RANK[level] < RANK[this.min]) return;
    const msg = message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message);
    const line = JSON.stringify({ ts: new Date().toISOString(), level: NAME[level] ?? level, context, msg, ...(message instanceof Error ? { stack: message.stack } : {}), ...extra });
    (level === 'error' || level === 'fatal' ? process.stderr : process.stdout).write(`${line}\n`);
  }

  log(message: unknown, context?: string) { this.write('log', message, context); }
  error(message: unknown, stackOrContext?: string, context?: string) { this.write('error', message, context ?? (stackOrContext?.includes('\n') ? undefined : stackOrContext), stackOrContext?.includes('\n') ? { stack: stackOrContext } : undefined); }
  warn(message: unknown, context?: string) { this.write('warn', message, context); }
  debug(message: unknown, context?: string) { this.write('debug', message, context); }
  verbose(message: unknown, context?: string) { this.write('verbose', message, context); }
  fatal(message: unknown, context?: string) { this.write('fatal', message, context); }

  /** Access-log line; not subject to Nest's context conventions. */
  access(fields: Record<string, unknown>) {
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', context: 'http', msg: 'request', ...fields })}\n`);
  }
}
