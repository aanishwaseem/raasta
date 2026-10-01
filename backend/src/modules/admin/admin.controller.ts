import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, ReqMeta, RequestMeta, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { PageQuery } from '../../common/dto';
import { AnalyticsService, parseRange } from '../analytics/analytics.service';
import { DemandService } from '../ai/demand.service';
import { FraudService } from '../fraud/fraud.service';
import { PaymentsService } from '../payments/payments.service';
import { SafetyService } from '../safety/safety.service';
import { SupportService } from '../support/support.service';
import { AdminService } from './admin.service';
import {
  AuditQuery, CancelRideAdminDto, CityDto, CityPatchDto, CityQuery, CorporateAccountDto, CorporateAccountPatchDto, DriverListQuery, ModelActivateDto, PricingUpdateDto, ProcessWithdrawalDto,
  PromotionDto, PromotionPatchDto, RangeQuery, ReasonDto, ResolveSafetyDto, ReviewDocumentDto, ReviewFraudDto, ReviewVehicleDto, RideListQuery, StatusFilterQuery, TrainDto, UpdateTicketDto, UserListQuery,
} from './dto/admin.dto';

/** Staff API. Class-level ADMIN; endpoints marked SUPPORT are also open to support agents. Every mutation is audited. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly analytics: AnalyticsService,
    private readonly fraud: FraudService,
    private readonly safety: SafetyService,
    private readonly support: SupportService,
    private readonly payments: PaymentsService,
    private readonly demand: DemandService,
  ) {}

  @Get('overview') overview(@Query() q: RangeQuery) { return this.analytics.kpis(parseRange(q.from, q.to, 1), { includeTestData: q.includeTestData !== 'false' }); }

  // users
  @Roles('ADMIN', 'SUPPORT') @Get('users') users(@Query() q: UserListQuery) { return this.admin.users(q); }
  @Roles('ADMIN', 'SUPPORT') @Get('users/:id') user(@Param('id', ParseUUIDPipe) id: string) { return this.admin.user(id); }
  @Post('users/:id/suspend') suspend(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @ReqMeta() m: RequestMeta) { return this.admin.setUserStatus(a, id, true, d.reason, m); }
  @Post('users/:id/reinstate') reinstate(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @ReqMeta() m: RequestMeta) { return this.admin.setUserStatus(a, id, false, d.reason, m); }

  // drivers
  @Roles('ADMIN', 'SUPPORT') @Get('drivers') drivers(@Query() q: DriverListQuery) { return this.admin.drivers(q); }
  @Roles('ADMIN', 'SUPPORT') @Get('drivers/:id') driver(@Param('id', ParseUUIDPipe) id: string) { return this.admin.driver(id); }
  @Post('drivers/:id/approve') approve(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @ReqMeta() m: RequestMeta) { return this.admin.approveDriver(a, id, d.reason, m); }
  @Post('drivers/:id/reject') reject(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @ReqMeta() m: RequestMeta) { return this.admin.rejectDriver(a, id, d.reason, m); }
  @Post('drivers/:id/suspend') suspendDriver(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @ReqMeta() m: RequestMeta) { return this.admin.setDriverSuspended(a, id, true, d.reason, m); }
  @Post('drivers/:id/reinstate') reinstateDriver(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @ReqMeta() m: RequestMeta) { return this.admin.setDriverSuspended(a, id, false, d.reason, m); }
  @Post('documents/:id/review') reviewDoc(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReviewDocumentDto, @ReqMeta() m: RequestMeta) { return this.admin.reviewDocument(a, id, d.decision, d.reason, m); }
  @Get('documents/:id/file')
  async docFile(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta, @Res() res: Response) {
    const f = await this.admin.documentFile(a, id, m);
    res.setHeader('content-type', f.contentType);
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('content-disposition', 'inline');
    res.end(f.buffer);
  }
  @Post('vehicles/:id/review') reviewVehicle(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReviewVehicleDto, @ReqMeta() m: RequestMeta) { return this.admin.reviewVehicle(a, id, d.decision, d.reason, m); }

  // rides
  @Roles('ADMIN', 'SUPPORT') @Get('rides') rideList(@Query() q: RideListQuery) { return this.admin.rides(q); }
  @Roles('ADMIN', 'SUPPORT') @Get('rides/:id') ride(@Param('id', ParseUUIDPipe) id: string) { return this.admin.ride(id); }
  @Post('rides/:id/cancel') cancelRide(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: CancelRideAdminDto, @ReqMeta() m: RequestMeta) {
    return this.admin.cancelRide(a, id, d.reason, m);
  }
  @Roles('ADMIN', 'SUPPORT') @Get('live-map') liveMap(@Query() q: CityQuery) { return this.admin.liveMap(q.cityId); }

  // money
  @Get('payments') paymentList(@Query() q: PageQuery & { status?: string; method?: string }) { return this.admin.payments(q); }
  @Get('wallets/:id/ledger') ledger(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) { return this.payments.ledgerFor(id, q); }
  @Get('withdrawals') withdrawals(@Query() q: StatusFilterQuery) { return this.admin.withdrawals(q); }
  @Post('withdrawals/:id/process') processWithdrawal(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ProcessWithdrawalDto) { return this.payments.processWithdrawal(a, id, d.decision, d.note); }
  @Get('promotions') promotions() { return this.admin.promotions(); }
  @Post('promotions') createPromotion(@CurrentUser() a: AuthUser, @Body() d: PromotionDto, @ReqMeta() m: RequestMeta) { return this.admin.createPromotion(a, d, m); }
  @Patch('promotions/:id') patchPromotion(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: PromotionPatchDto, @ReqMeta() m: RequestMeta) { return this.admin.patchPromotion(a, id, d, m); }
  @Get('pricing') pricing() { return this.admin.pricingConfigs(); }
  @Put('pricing/:id') updatePricing(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: PricingUpdateDto, @ReqMeta() m: RequestMeta) { return this.admin.updatePricing(a, id, d, m); }

  // support & safety
  @Roles('ADMIN', 'SUPPORT') @Get('support/tickets') tickets(@Query() q: StatusFilterQuery) { return this.support.adminList(q); }
  @Roles('ADMIN', 'SUPPORT') @Patch('support/tickets/:id') updateTicket(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateTicketDto, @ReqMeta() m: RequestMeta) { return this.support.adminUpdate(a, id, { status: d.status, priority: d.priority, assignedTo: d.assignedTo }, m); }
  @Roles('ADMIN', 'SUPPORT') @Get('support/tickets/:id') ticket(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.support.get(a, id); }
  @Roles('ADMIN', 'SUPPORT') @Post('support/tickets/:id/messages') replyTicket(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: { body: string }) { return this.support.addMessage(a, id, d.body); }
  @Roles('ADMIN', 'SUPPORT') @Get('safety/events') safetyEvents(@Query() q: StatusFilterQuery) { return this.safety.list(q); }
  @Roles('ADMIN', 'SUPPORT') @Post('safety/events/:id/resolve') resolveSafety(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ResolveSafetyDto) { return this.safety.resolve(a, id, d.status, d.note); }

  // fraud (internal only)
  @Get('fraud/events') fraudEvents(@Query() q: StatusFilterQuery) { return this.fraud.list(q); }
  @Post('fraud/events/:id/review') reviewFraud(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReviewFraudDto, @ReqMeta() m: RequestMeta) { return this.fraud.review(a, id, d.decision, d.note, m); }
  @Post('fraud/scan') scanFraud() { return this.fraud.scan(); }

  // analytics
  @Get('analytics/kpis') kpis(@Query() q: RangeQuery) { return this.analytics.kpis(parseRange(q.from, q.to), { includeTestData: q.includeTestData !== 'false' }); }
  @Get('analytics/timeseries') timeseries(@Query() q: RangeQuery) { return this.analytics.timeseries(q.metric ?? 'requests', parseRange(q.from, q.to), q.interval ?? 'day'); }
  @Get('analytics/cancellations') cancellations(@Query() q: RangeQuery) { return this.analytics.cancellations(parseRange(q.from, q.to, 30)); }
  @Get('demand/forecast') async forecast(@Query() q: CityQuery) {
    const cityId = q.cityId ?? (await this.admin.cities())[0]?.id;
    return { cityId, zones: await this.demand.forCity(cityId, { fresh: true }) };
  }

  // geography
  @Get('cities') cities() { return this.admin.cities(); }
  @Post('cities') createCity(@CurrentUser() a: AuthUser, @Body() d: CityDto, @ReqMeta() m: RequestMeta) { return this.admin.createCity(a, d, m); }
  @Patch('cities/:id') patchCity(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: CityPatchDto, @ReqMeta() m: RequestMeta) { return this.admin.patchCity(a, id, d, m); }
  @Get('zones') zones(@Query() q: CityQuery) { return this.admin.zones(q.cityId); }
  @Post('zones') createZone(@CurrentUser() a: AuthUser, @Body() d: { cityId: string; code: string; name: string; polygon: number[][] }, @ReqMeta() m: RequestMeta) { return this.admin.createZone(a, d, m); }
  @Patch('zones/:id') patchZone(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: { active?: boolean; name?: string }, @ReqMeta() m: RequestMeta) { return this.admin.patchZone(a, id, d, m); }
  @Get('service-areas') areas(@Query() q: CityQuery) { return this.admin.serviceAreas(q.cityId); }
  @Post('service-areas') createArea(@CurrentUser() a: AuthUser, @Body() d: { cityId: string; name: string; kind: 'SERVICE' | 'AIRPORT' | 'RESTRICTED'; polygon: number[][] }, @ReqMeta() m: RequestMeta) { return this.admin.createServiceArea(a, d, m); }
  @Patch('service-areas/:id') patchArea(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: { active?: boolean }, @ReqMeta() m: RequestMeta) { return this.admin.patchServiceArea(a, id, d, m); }
  @Get('corporate-accounts') corporate() { return this.admin.corporateAccounts(); }
  @Post('corporate-accounts') createCorporate(@CurrentUser() a: AuthUser, @Body() d: CorporateAccountDto, @ReqMeta() m: RequestMeta) { return this.admin.createCorporateAccount(a, d, m); }
  @Patch('corporate-accounts/:id') patchCorporate(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: CorporateAccountPatchDto, @ReqMeta() m: RequestMeta) { return this.admin.patchCorporateAccount(a, id, d, m); }

  // AI operations
  @Get('ai/models') models() { return this.admin.aiModels(); }
  @Post('ai/train') train(@CurrentUser() a: AuthUser, @Body() d: TrainDto, @ReqMeta() m: RequestMeta) { return this.admin.trainModels(a, d.models, m); }
  @Post('ai/models/:id/activate') activate(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ModelActivateDto, @ReqMeta() m: RequestMeta) { return this.admin.activateModel(a, id, d.reason, m); }
  @Get('ai/monitoring') monitoring(@Query() q: RangeQuery) { return this.analytics.aiMonitoring(parseRange(q.from, q.to, 7)); }

  // system
  @Get('system/health') health() { return this.admin.systemHealth(); }
  @Get('audit-logs') audit(@Query() q: AuditQuery) { return this.admin.auditLogs(q); }
}
