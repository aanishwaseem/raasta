import { BadRequestException, Body, Controller, Get, Header, Injectable, Param, ParseUUIDPipe, PipeTransform, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { Idempotent } from '../../common/idempotency/idempotency';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { SafetyService } from '../safety/safety.service';
import { RidesService } from './rides.service';
import { RideViewService } from './ride-view.service';
import { CancelRideDto, QuoteRequestDto, RatingDto, RideHistoryQuery, RideRequestDto, SafetyResponseDto, ShareRideDto, SosDto } from './dto/rides.dto';

/** Tracking tokens are 32 url-safe characters; anything else is rejected before touching the database. */
@Injectable()
class ParseTokenPipe implements PipeTransform<string, string> {
  transform(v: string): string {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(v)) throw new BadRequestException('Invalid tracking link');
    return v;
  }
}

class RetryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(100000) offeredFare?: number;
}

@ApiTags('rides')
@ApiBearerAuth()
@Controller('rides')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly views: RideViewService,
    private readonly safety: SafetyService,
  ) {}

  @Post('quotes')
  @Roles('PASSENGER')
  @RateLimit({ name: 'quote', limit: 30, windowSec: 60, by: 'user' })
  quote(@CurrentUser() u: AuthUser, @Body() dto: QuoteRequestDto) {
    return this.rides.quote(u.id, dto.pickup, dto.dropoff, { promoCode: dto.promoCode, corporateId: dto.corporateId, seats: dto.seats });
  }

  @Post()
  @Roles('PASSENGER')
  @Idempotent('ride-request')
  @RateLimit({ name: 'ride-request', limit: 10, windowSec: 60, by: 'user' })
  request(@CurrentUser() u: AuthUser, @Body() dto: RideRequestDto) {
    return this.rides.request(u, dto);
  }

  @Get('active')
  @Roles('PASSENGER')
  active(@CurrentUser() u: AuthUser) {
    return this.rides.active(u);
  }

  @Get()
  history(@CurrentUser() u: AuthUser, @Query() q: RideHistoryQuery) {
    return this.rides.history(u, q);
  }

  @Get(':id')
  detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.forUser(u, id);
  }

  @Get(':id/events')
  events(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.events_(u, id);
  }

  @Post(':id/cancel')
  @Roles('PASSENGER')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelRideDto) {
    return this.rides.cancelByPassenger(u, id, dto);
  }

  @Post(':id/retry')
  @Roles('PASSENGER')
  @Idempotent('ride-retry')
  retry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryDto) {
    return this.rides.retry(u, id, dto.offeredFare);
  }

  @Post(':id/rating')
  @RateLimit({ name: 'rating', limit: 20, windowSec: 600, by: 'user' })
  rate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RatingDto) {
    return this.rides.rate(u, id, dto);
  }

  @Get(':id/receipt')
  receipt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.receipt(u, id);
  }

  @Post(':id/share')
  @RateLimit({ name: 'ride-share', limit: 10, windowSec: 3600, by: 'user' }) // each share can send an SMS to a third party
  share(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShareRideDto) {
    return this.safety.createShare(u, id, { contactIds: dto.emergencyContactIds, name: dto.name, phone: dto.phone });
  }

  @Post(':id/sos')
  @RateLimit({ name: 'sos', limit: 5, windowSec: 60, by: 'user' })
  sos(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SosDto) {
    return this.safety.sos(u, id, dto.location);
  }
}

@ApiTags('safety')
@Controller()
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @ApiBearerAuth()
  @Post('safety/events/:id/respond')
  respond(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SafetyResponseDto) {
    return this.safety.respond(u, id, dto.response);
  }

  @Public()
  @Get('public/track/:token')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @RateLimit({ name: 'track', limit: 60, windowSec: 60, by: 'ip' })
  track(@Param('token', new ParseTokenPipe()) token: string) {
    return this.safety.publicTrack(token);
  }
}
