import { Global, Module } from '@nestjs/common';
import { AiClient } from './ai/ai.client';
import { DemandService } from './ai/demand.service';
import { PredictionsService } from './ai/predictions.service';
import { CorporatePolicyService } from './business/corporate-policy.service';
import { DriverPresenceService } from './drivers/driver-presence.service';
import { DriverStatsService } from './drivers/driver-stats.service';
import { MatchingService } from './matching/matching.service';
import { PricingService } from './pricing/pricing.service';
import { PromotionsService } from './promotions/promotions.service';
import { RideRepository } from './rides/ride.repository';
import { RideViewService } from './rides/ride-view.service';
import { RidesService } from './rides/rides.service';
import { SafetyService } from './safety/safety.service';

/**
 * Shared domain services used across feature modules (rides, drivers, assistant, scheduling, admin).
 * Kept in one global module so feature modules stay thin controllers without import cycles.
 */
const SERVICES = [
  AiClient,
  PredictionsService,
  DemandService,
  DriverPresenceService,
  DriverStatsService,
  PromotionsService,
  PricingService,
  CorporatePolicyService,
  RideRepository,
  RideViewService,
  MatchingService,
  SafetyService,
  RidesService,
];

@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class CoreModule {}
