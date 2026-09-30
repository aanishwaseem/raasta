import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsService } from '../analytics/analytics.service';
import { FraudService } from '../fraud/fraud.service';
import { DriversModule } from '../drivers/drivers.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Global()
@Module({
  imports: [AuthModule, DriversModule],
  controllers: [AdminController],
  providers: [AdminService, AnalyticsService, FraudService],
  exports: [AdminService, AnalyticsService, FraudService],
})
export class AdminModule {}
