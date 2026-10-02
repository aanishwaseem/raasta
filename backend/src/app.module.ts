import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard, RolesGuard } from './common/auth/guards';
import { AdminAuditInterceptor } from './common/audit/admin-audit.interceptor';
import { CommonModule } from './common/common.module';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { IdempotencyInterceptor } from './common/idempotency/idempotency';
import { RateLimitGuard } from './common/rate-limit/rate-limit';
import { AuthModule } from './modules/auth/auth.module';
import { CoreModule } from './modules/core.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { GeoModule } from './modules/geo/geo.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CorporateModule } from './modules/business/corporate.module';
import { DeliveryModule } from './modules/delivery/delivery.controller';
import { IntercityModule } from './modules/intercity/intercity.module';
import { SupportModule } from './modules/support/support.module';
import { AdminModule } from './modules/admin/admin.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RidesModule } from './modules/rides/rides.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    CommonModule,
    GeoModule,
    RealtimeModule,
    NotificationsModule,
    PaymentsModule,
    CoreModule,
    AuthModule,
    UsersModule,
    RidesModule,
    DriversModule,
    SchedulingModule,
    AssistantModule,
    CorporateModule,
    IntercityModule,
    DeliveryModule,
    SupportModule,
    AdminModule,
    MaintenanceModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // order matters: authenticate → authorise → rate limit
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor },
  ],
})
export class AppModule {}
