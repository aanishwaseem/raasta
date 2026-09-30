import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { config } from './config/config';
import { MetricsService } from './common/metrics/metrics.service';
import { QueueService } from './common/queue/queue.service';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

export async function createApp(): Promise<NestExpressApplication> {
  const cfg = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: true });
  app.set('trust proxy', cfg.NODE_ENV === 'production' ? 1 : false);
  app.use(helmet());
  app.enableCors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, exposedHeaders: ['x-request-id'] });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'metrics'] });

  const metrics = app.get(MetricsService);
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    req.id = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', req.id);
    const end = metrics.httpDuration.startTimer();
    res.on('finish', () => end({ method: req.method, route: (req.route?.path as string) ?? 'unmatched', status: String(res.statusCode) }));
    next();
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));

  if (cfg.SWAGGER_ENABLED && cfg.NODE_ENV !== 'production') {
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
