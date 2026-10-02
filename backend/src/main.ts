import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { config, corsOrigins } from './config/config';
import { JsonLogger } from './common/logging/json-logger';
import { MetricsService } from './common/metrics/metrics.service';
import { QueueService } from './common/queue/queue.service';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

export async function createApp(): Promise<NestExpressApplication> {
  const cfg = config();
  const jsonLogs = cfg.LOG_FORMAT === 'json' || (cfg.LOG_FORMAT === 'auto' && cfg.NODE_ENV === 'production');
  const logger = jsonLogs ? new JsonLogger() : undefined;
  // The body parser is registered here (not by Nest) so malformed / oversized bodies get the same JSON error envelope as every other
  // failure instead of Express' default HTML error page (which includes a stack trace outside production).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: logger ?? ['error', 'warn', 'log'], bodyParser: false });
  app.set('trust proxy', cfg.NODE_ENV === 'production' ? 1 : false);
  app.disable('x-powered-by');
  const swaggerOn = cfg.SWAGGER_ENABLED && cfg.NODE_ENV !== 'production';
  app.use(
    helmet({
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }, // only sent over HTTPS by browsers; the TLS terminator must also send it
      // this is a JSON API: nothing should ever render (Swagger UI in dev needs helmet's default CSP)
      contentSecurityPolicy: swaggerOn ? undefined : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.enableCors({
    origin: corsOrigins(cfg),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after', 'idempotent-replay'],
    maxAge: 600,
  });
  // authenticated JSON must never be stored by shared caches or the browser; individual handlers (avatars) may override
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });
  const metrics = app.get(MetricsService);
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    // a client-supplied id is only trusted if it is short and boring (it lands in logs and the audit trail)
    const supplied = req.headers['x-request-id'];
    req.id = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{8,64}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('x-request-id', req.id);
    const end = metrics.httpDuration.startTimer();
    const startedAt = Date.now();
    res.on('finish', () => {
      const route = (req.route?.path as string) ?? 'unmatched';
      end({ method: req.method, route, status: String(res.statusCode) });
      // access log: ids and routes only, never bodies, query strings or tokens
      logger?.access({ requestId: req.id, method: req.method, route, status: res.statusCode, durationMs: Date.now() - startedAt, userId: (req as Request & { user?: { id: string } }).user?.id });
    });
    next();
  });

  const parseJson = json({ limit: '100kb', strict: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    parseJson(req, res, (err?: unknown) => {
      if (!err) return next();
      const e = err as { status?: number; type?: string };
      const tooLarge = e.status === 413 || e.type === 'entity.too.large';
      res.status(tooLarge ? 413 : 400).json({
        error: {
          code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED',
          message: tooLarge ? 'The request body is too large' : 'The request body is not valid JSON',
          requestId: (req as Request & { id?: string }).id,
        },
      });
    });
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'metrics'] });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));

  if (swaggerOn) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Raasta API').setVersion('1.0').addBearerAuth().setDescription('Ride-hailing and mobility platform API').build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  const io = new RedisIoAdapter(app);
  io.connectToRedis();
  app.useWebSocketAdapter(io);
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = await createApp();
  if (config().RUN_WORKERS_IN_API) await app.get(QueueService).startWorkers();
  await app.listen(config().PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`Raasta API listening on :${config().PORT} (workers ${config().RUN_WORKERS_IN_API ? 'in-process' : 'external'})`);
}

if (require.main === module) void bootstrap();
