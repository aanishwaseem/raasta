import { Body, Controller, Get, Header, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { PageQuery } from '../../common/dto';
import { Idempotent } from '../../common/idempotency/idempotency';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryDto, DeliveryCancelDto, DeliveryQuoteDto, DeliverDto, OpenDeliveriesQuery } from './dto/delivery.dto';

@ApiTags('delivery')
@ApiBearerAuth()
@Controller()
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Roles('PASSENGER') @Post('deliveries/quote') quote(@Body() dto: DeliveryQuoteDto) { return this.delivery.quote(dto); }
  @Roles('PASSENGER') @Idempotent('delivery-create') @Post('deliveries') create(@CurrentUser() u: AuthUser, @Body() dto: CreateDeliveryDto) { return this.delivery.create(u, dto); }
  @Roles('PASSENGER') @Get('deliveries') list(@CurrentUser() u: AuthUser, @Query() q: PageQuery) { return this.delivery.list(u, q); }
  @Roles('PASSENGER', 'ADMIN', 'SUPPORT') @Get('deliveries/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.delivery.get(u, id); }
  @Roles('PASSENGER', 'ADMIN', 'SUPPORT') @Post('deliveries/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliveryCancelDto) { return this.delivery.cancel(u, id, dto.reason); }

  // unauthenticated: the code is the only secret, so it is throttled per IP and never cached or leaked via Referer
  @Public() @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer') @Header('X-Robots-Tag', 'noindex, nofollow')
  @RateLimit({ name: 'delivery-track', limit: 30, windowSec: 60, by: 'ip' })
  @Get('public/deliveries/:code') track(@Param('code') code: string) { return this.delivery.track(code.slice(0, 16)); }

  @Roles('DRIVER') @Get('driver/deliveries/open') open(@CurrentUser() u: AuthUser, @Query() q: OpenDeliveriesQuery) { return this.delivery.open(u.id, q); }
  @Roles('DRIVER') @Get('driver/deliveries/active') active(@CurrentUser() u: AuthUser) { return this.delivery.mineAsDriver(u.id); }
  @Roles('DRIVER') @Post('driver/deliveries/:id/accept') accept(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.delivery.accept(u.id, id); }
  @Roles('DRIVER') @Post('driver/deliveries/:id/release') release(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.delivery.release(u.id, id); }
  @Roles('DRIVER') @Post('driver/deliveries/:id/pickup') pickup(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.delivery.pickUp(u.id, id); }
  @Roles('DRIVER') @Post('driver/deliveries/:id/deliver') deliver(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto) { return this.delivery.deliver(u.id, id, dto.pin, dto.note); }
}

@Module({ controllers: [DeliveryController], providers: [DeliveryService], exports: [DeliveryService] })
export class DeliveryModule {}
