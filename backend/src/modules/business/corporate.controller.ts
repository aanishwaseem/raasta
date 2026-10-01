import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser, ReqMeta, RequestMeta, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { PageQuery } from '../../common/dto';
import { CorporateService } from './corporate.service';
import { AddEmployeeDto, BudgetDto, CorporateScheduleDto, PolicyDto, UpdateEmployeeDto } from './dto/corporate.dto';

class CorpQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() corporateId?: string;
}
class CorpPageQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() corporateId?: string;
}

@ApiTags('corporate')
@ApiBearerAuth()
@Roles('CORPORATE_ADMIN')
@Controller('corporate')
export class CorporateController {
  constructor(private readonly corp: CorporateService) {}

  @Get('overview') overview(@CurrentUser() u: AuthUser, @Query() q: CorpQuery) { return this.corp.overview(u, q.corporateId); }
  @Get('employees') employees(@CurrentUser() u: AuthUser, @Query() q: CorpQuery) { return this.corp.employees(u, q.corporateId); }
  @Post('employees') add(@CurrentUser() u: AuthUser, @Body() dto: AddEmployeeDto, @Query() q: CorpQuery, @ReqMeta() m: RequestMeta) { return this.corp.addEmployee(u, dto, q.corporateId, m); }
  @Patch('employees/:userId') update(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto, @Query() q: CorpQuery, @ReqMeta() m: RequestMeta) { return this.corp.updateEmployee(u, id, dto, q.corporateId, m); }
  @Get('policy') policy(@CurrentUser() u: AuthUser, @Query() q: CorpQuery) { return this.corp.policy(u, q.corporateId); }
  @Put('policy') setPolicy(@CurrentUser() u: AuthUser, @Body() dto: PolicyDto, @Query() q: CorpQuery, @ReqMeta() m: RequestMeta) { return this.corp.setPolicy(u, dto, q.corporateId, m); }
  @Patch('budget') budget(@CurrentUser() u: AuthUser, @Body() dto: BudgetDto, @Query() q: CorpQuery, @ReqMeta() m: RequestMeta) { return this.corp.setBudget(u, dto, q.corporateId, m); }
  @Get('rides') rides(@CurrentUser() u: AuthUser, @Query() q: CorpPageQuery) { return this.corp.rides(u, q, q.corporateId); }
  @Get('invoices') invoice(@CurrentUser() u: AuthUser, @Query('month') month: string, @Query() q: CorpQuery) { return this.corp.invoice(u, month, q.corporateId); }
  @Post('scheduled-rides') schedule(@CurrentUser() u: AuthUser, @Body() dto: CorporateScheduleDto, @Query() q: CorpQuery) { return this.corp.scheduleForEmployee(u, dto, q.corporateId); }
}
