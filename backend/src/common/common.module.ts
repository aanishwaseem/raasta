import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './db/database.service';
import { RedisService } from './redis/redis.service';
import { EventBus } from './events/event-bus';
import { MetricsService } from './metrics/metrics.service';
import { MetricsProbes } from './metrics/probes.service';
import { AuditService } from './audit/audit.service';
import { QueueService } from './queue/queue.service';
import { config } from '../config/config';
import { FcmPushProvider } from './providers/fcm.provider';
import { HttpSmsProvider, TwilioSmsProvider } from './providers/sms.providers';
import { ConsolePushProvider, ConsoleSmsProvider, DevOutbox, PushProvider, SmsProvider } from './providers/messaging';
import { LocalDiskStorage, StorageProvider } from './providers/storage';

@Global()
@Module({
  providers: [
    DatabaseService,
    RedisService,
    EventBus,
    MetricsService,
    MetricsProbes,
    AuditService,
    QueueService,
    DevOutbox,
    { provide: SmsProvider, useClass: { console: ConsoleSmsProvider, twilio: TwilioSmsProvider, http: HttpSmsProvider }[config().SMS_PROVIDER] },
    { provide: PushProvider, useClass: config().PUSH_PROVIDER === 'fcm' ? FcmPushProvider : ConsolePushProvider },
    { provide: StorageProvider, useClass: LocalDiskStorage },
  ],
  exports: [DatabaseService, RedisService, EventBus, MetricsService, AuditService, QueueService, DevOutbox, SmsProvider, PushProvider, StorageProvider],
})
export class CommonModule {}
