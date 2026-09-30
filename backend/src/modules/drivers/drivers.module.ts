import { Module } from '@nestjs/common';
import { DriverInsightsService } from './driver-insights.service';
import { DriversController } from './drivers.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [DriversController],
  providers: [OnboardingService, DriverInsightsService],
  exports: [OnboardingService, DriverInsightsService],
})
export class DriversModule {}
