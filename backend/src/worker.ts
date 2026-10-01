import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { QueueService } from './common/queue/queue.service';

/** Standalone queue worker process (matching, scheduling, maintenance, notifications). */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  await app.get(QueueService).startWorkers();
  new Logger('Worker').log('Raasta worker running');
}
void bootstrap();
