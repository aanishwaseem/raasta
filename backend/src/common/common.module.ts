import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './db/database.service';
import { RedisService } from './redis/redis.service';
import { EventBus } from './events/event-bus';
import { MetricsService } from './metrics/metrics.service';
import { AuditService } from './audit/audit.service';
import { QueueService } from './queue/queue.service';
import { ConsolePushProvider, ConsoleSmsProvider, DevOutbox, PushProvider, SmsProvider } from './providers/messaging';
import { LocalDiskStorage, StorageProvider } from './providers/storage';

@Global()
@Module({
  providers: [
    DatabaseService,
    RedisService,
    EventBus,
    MetricsService,
    AuditService,
    QueueService,
    DevOutbox,
    { provide: SmsProvider, useClass: ConsoleSmsProvider },
    { provide: PushProvider, useClass: ConsolePushProvider },
    { provide: StorageProvider, useClass: LocalDiskStorage },
  ],
  exports: [DatabaseService, RedisService, EventBus, MetricsService, AuditService, QueueService, DevOutbox, SmsProvider, PushProvider, StorageProvider],
})
export class CommonModule {}
