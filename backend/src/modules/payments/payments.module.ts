import { Body, Controller, Delete, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { config } from '../../config/config';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { PageQuery } from '../../common/dto';
import { Idempotent } from '../../common/idempotency/idempotency';
import { LedgerService } from './ledger.service';
import { MockPaymentProvider, PaymentProvider, StripePaymentProvider } from './payment-provider';
import { PaymentsService } from './payments.service';

class TopupDto {
  @ApiProperty({ example: 1000 }) @Type(() => Number) @IsInt() @Min(100) @Max(50000) amount: number;
  @ApiProperty() @IsUUID() paymentMethodId: string;
}

class AddPaymentMethodDto {
  @ApiProperty({ enum: ['mock', 'stripe'] }) @IsIn(['mock', 'stripe', 'MOCK', 'STRIPE']) provider: string;
  @ApiProperty({ description: 'Token from the provider SDK (e.g. tok_visa in mock mode). Never send card numbers.' })
  @IsString()
  @MaxLength(200)
  token: string;
}

@ApiTags('wallet')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('wallet')
  @Roles('PASSENGER')
  wallet(@CurrentUser() u: AuthUser) {
    return this.payments.walletSummary(u.id, 'PASSENGER');
  }

  @Get('wallet/transactions')
  @Roles('PASSENGER')
  transactions(@CurrentUser() u: AuthUser, @Query() q: PageQuery) {
    return this.payments.transactions(u.id, 'PASSENGER', q);
  }

  @Post('wallet/topups')
  @Roles('PASSENGER')
  @Idempotent('wallet-topup')
  topup(@CurrentUser() u: AuthUser, @Body() dto: TopupDto, @Req() req: Request) {
    return this.payments.topup(u.id, dto.amount, dto.paymentMethodId, String(req.headers['idempotency-key']));
  }

  @Get('payment-methods')
  methods(@CurrentUser() u: AuthUser) {
    return this.payments.listPaymentMethods(u.id);
  }

  @Post('payment-methods')
  addMethod(@CurrentUser() u: AuthUser, @Body() dto: AddPaymentMethodDto) {
    return this.payments.addPaymentMethod(u.id, dto.provider, dto.token);
  }

  @Delete('payment-methods/:id')
  @HttpCode(204)
  async removeMethod(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.payments.removePaymentMethod(u.id, id);
  }

  @Post('rides/:id/pay-cash')
  payCash(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.fallbackToCash(id, u);
  }
}

@Global()
@Module({
  controllers: [PaymentsController],
  providers: [
    LedgerService,
    PaymentsService,
    { provide: PaymentProvider, useClass: config().PAYMENT_PROVIDER === 'stripe' ? StripePaymentProvider : MockPaymentProvider },
  ],
  exports: [LedgerService, PaymentsService, PaymentProvider],
})
export class PaymentsModule {}
