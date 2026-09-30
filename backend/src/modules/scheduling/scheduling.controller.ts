import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { SchedulingService } from './scheduling.service';
import { RecurringRideDto, ScheduleRideDto } from './dto/scheduling.dto';

class AutoDispatchDto {
  @ApiProperty() @IsBoolean() autoDispatch: boolean;
}

@ApiTags('scheduling')
@ApiBearerAuth()
@Roles('PASSENGER')
@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Post('scheduled-rides')
  create(@CurrentUser() u: AuthUser, @Body() dto: ScheduleRideDto) {
    return this.scheduling.create(u, dto);
  }
  @Get('scheduled-rides')
  list(@CurrentUser() u: AuthUser) {
    return this.scheduling.list(u.id);
  }
  @Get('scheduled-rides/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.get(u.id, id);
  }
  @Post('scheduled-rides/:id/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.confirm(u, id);
  }
  @Delete('scheduled-rides/:id')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.cancel(u.id, id);
  }

  @Post('recurring-rides')
  createRecurring(@CurrentUser() u: AuthUser, @Body() dto: RecurringRideDto) {
    return this.scheduling.createRecurring(u, dto);
  }
  @Get('recurring-rides')
  listRecurring(@CurrentUser() u: AuthUser) {
    return this.scheduling.listRecurring(u.id);
  }
  @Patch('recurring-rides/:id/auto-dispatch')
  autoDispatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AutoDispatchDto) {
    return this.scheduling.setAutoDispatch(u.id, id, dto.autoDispatch);
  }
  @Delete('recurring-rides/:id')
  deleteRecurring(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.deleteRecurring(u.id, id);
  }
}
