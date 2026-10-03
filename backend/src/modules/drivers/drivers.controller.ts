import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { PageQuery } from '../../common/dto';
import { Idempotent } from '../../common/idempotency/idempotency';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { MatchingService } from '../matching/matching.service';
import { PaymentsService } from '../payments/payments.service';
import { RidesService } from '../rides/rides.service';
import { DriverInsightsService } from './driver-insights.service';
import { DriverPresenceService } from './driver-presence.service';
import { OnboardingService } from './onboarding.service';
import {
  CompleteRideDto,
  DeclineDto,
  DocumentUploadDto,
  DriverCancelDto,
  DriverPreferencesDto,
  GoOnlineDto,
  IdentityDto,
  LocationDto,
  StartRideDto,
  TrainingDto,
  VehicleDto,
  WithdrawalDto,
} from './dto/drivers.dto';

const MAX_DOC_BYTES = 8 * 1024 * 1024;

@ApiTags('driver')
@ApiBearerAuth()
@Roles('DRIVER')
@Controller('driver')
export class DriversController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly presence: DriverPresenceService,
    private readonly matching: MatchingService,
    private readonly rides: RidesService,
    private readonly insights: DriverInsightsService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.onboarding.profile(u.id);
  }

  // ---------------------------------------------------------------- onboarding
  @Post('onboarding/identity')
  identity(@CurrentUser() u: AuthUser, @Body() dto: IdentityDto) {
    return this.onboarding.submitIdentity(u.id, dto);
  }

  @Post('vehicles')
  addVehicle(@CurrentUser() u: AuthUser, @Body() dto: VehicleDto) {
    return this.onboarding.addVehicle(u.id, dto);
  }

  @Get('vehicles')
  vehicles(@CurrentUser() u: AuthUser) {
    return this.onboarding.vehicles(u.id);
  }

  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @RateLimit({ name: 'doc-upload', limit: 20, windowSec: 3600, by: 'user' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOC_BYTES, files: 1 } }))
  upload(@CurrentUser() u: AuthUser, @Body() dto: DocumentUploadDto, @UploadedFile() file?: Express.Multer.File) {
    return this.onboarding.uploadDocument(u.id, dto, file ? { buffer: file.buffer, size: file.size } : undefined);
  }

  @Get('documents')
  documents(@CurrentUser() u: AuthUser) {
    return this.onboarding.documents(u.id);
  }

  @Post('onboarding/submit')
  submit(@CurrentUser() u: AuthUser) {
    return this.onboarding.submitForReview(u.id);
  }

  @Post('onboarding/training')
  training(@CurrentUser() u: AuthUser, @Body() dto: TrainingDto) {
    return this.onboarding.acknowledgeTraining(u.id, dto.acknowledged);
  }

  @Patch('preferences')
  preferences(@CurrentUser() u: AuthUser, @Body() dto: DriverPreferencesDto) {
    return this.onboarding.updatePreferences(u.id, { ...dto });
  }

  // ---------------------------------------------------------------- presence
  @Post('online')
  @HttpCode(200)
  online(@CurrentUser() u: AuthUser, @Body() dto: GoOnlineDto) {
    return this.presence.goOnline(u.id, { lat: dto.lat, lng: dto.lng });
  }

  @Post('offline')
  @HttpCode(200)
  async offline(@CurrentUser() u: AuthUser) {
    await this.presence.goOffline(u.id);
    return { online: false };
  }

  @Post('location')
  @HttpCode(200)
  @RateLimit({ name: 'driver-location', limit: 120, windowSec: 60, by: 'user' })
  location(@CurrentUser() u: AuthUser, @Body() dto: LocationDto) {
    return this.presence.updateLocation(u.id, {
      lat: dto.lat,
      lng: dto.lng,
      heading: dto.heading,
      speed: dto.speed,
      accuracy: dto.accuracy,
      recordedAt: dto.recordedAt,
    });
  }

  // ---------------------------------------------------------------- offers & rides
  @Get('offers/current')
  currentOffer(@CurrentUser() u: AuthUser) {
    return this.matching.currentOffer(u.id);
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.matching.accept(u.id, id);
  }

  @Post('offers/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineDto) {
    return this.matching.decline(u.id, id, dto.reason);
  }

  @Get('rides/active')
  activeRides(@CurrentUser() u: AuthUser) {
    return this.rides.activeForDriver(u.id);
  }

  @Post('rides/:id/arrived')
  @HttpCode(200)
  arrived(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.arrived(u.id, id);
  }

  @Post('rides/:id/start')
  @HttpCode(200)
  @RateLimit({ name: 'ride-start', limit: 10, windowSec: 60, by: 'user' })
  start(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartRideDto) {
    return this.rides.start(u.id, id, dto.pin);
  }

  @Post('rides/:id/complete')
  @HttpCode(200)
  @Idempotent('ride-complete', false)
  complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteRideDto) {
    return this.rides.complete(u.id, id, dto.lat !== undefined && dto.lng !== undefined ? { lat: dto.lat, lng: dto.lng } : undefined);
  }

  @Post('rides/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DriverCancelDto) {
    return this.rides.cancelByDriver(u.id, id, dto.reason);
  }

  // ---------------------------------------------------------------- insights & money
  @Get('copilot')
  copilot(@CurrentUser() u: AuthUser) {
    return this.insights.copilot(u.id);
  }

  @Get('earnings')
  earnings(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.insights.earnings(u.id, from, to);
  }

  @Get('demand')
  demand(@CurrentUser() u: AuthUser) {
    return this.insights.demandZones(u.id);
  }

  @Get('wallet')
  wallet(@CurrentUser() u: AuthUser) {
    return this.payments.walletSummary(u.id, 'DRIVER');
  }

  @Get('wallet/transactions')
  transactions(@CurrentUser() u: AuthUser, @Query() q: PageQuery) {
    return this.payments.transactions(u.id, 'DRIVER', q);
  }

  @Post('withdrawals')
  @Idempotent('driver-withdrawal')
  @RateLimit({ name: 'withdrawal', limit: 5, windowSec: 3600, by: 'user' })
  withdraw(@CurrentUser() u: AuthUser, @Body() dto: WithdrawalDto) {
    return this.payments.requestWithdrawal(u.id, dto.amount, { method: dto.method, accountNumber: dto.accountNumber, accountTitle: dto.accountTitle });
  }
}
