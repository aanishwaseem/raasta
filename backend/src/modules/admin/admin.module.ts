import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsService } from '../analytics/analytics.service';
import { FraudService } from '../fraud/fraud.service';
import { DeliveryModule } from '../delivery/delivery.controller';
import { DriversModule } from '../drivers/drivers.module';
import { AdminController } from './admin.controller';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';
import { AdminService } from './admin.service';

@Global()
@Module({
  imports: [AuthModule, DriversModule, DeliveryModule],
  controllers: [AdminController, AdminOpsController],
  providers: [AdminService, AdminOpsService, AnalyticsService, FraudService],
  exports: [AdminService, AnalyticsService, FraudService],
})
export class AdminModule {}
