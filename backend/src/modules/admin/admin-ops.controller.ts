import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/decorators';
import { PageQuery } from '../../common/dto';
import { parseRange } from '../analytics/analytics.service';
import { DeliveryService } from '../delivery/delivery.service';
import { AdminOpsService } from './admin-ops.service';
import { RangeQuery } from './dto/admin.dto';

class VehicleListQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
}
class WalletListQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(30) ownerType?: string;
}
class DeliveryListQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(20) status?: string;
}
class AiOpsQuery extends RangeQuery {
  @IsOptional() @IsUUID() cityId?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService, private readonly deliveries: DeliveryService) {}

  @Roles('ADMIN', 'SUPPORT') @Get('vehicles') vehicles(@Query() q: VehicleListQuery) { return this.ops.vehicles(q); }
  @Get('wallets') wallets(@Query() q: WalletListQuery) { return this.ops.wallets(q); }
  @Roles('ADMIN', 'SUPPORT') @Get('deliveries') deliveryList(@Query() q: DeliveryListQuery) { return this.deliveries.adminList(q); }
  @Get('ops/ai') aiOps(@Query() q: AiOpsQuery) { return this.ops.aiOps(parseRange(q.from, q.to, 7), q.cityId); }
}
