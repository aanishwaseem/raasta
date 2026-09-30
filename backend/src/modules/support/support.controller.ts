import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { PageQuery } from '../../common/dto';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { SupportService, TICKET_CATEGORIES, TicketCategory } from './support.service';

export class CreateTicketDto {
  @ApiProperty({ enum: TICKET_CATEGORIES }) @IsIn(TICKET_CATEGORIES) category: TicketCategory;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(120) subject: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() rideId?: string;
}
export class TicketMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) body: string;
}

@ApiTags('support')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @RateLimit({ name: 'ticket', limit: 10, windowSec: 3600, by: 'user' })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.create(u, dto);
  }
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: PageQuery) { return this.support.list(u, q); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.support.get(u, id); }
  @Post(':id/messages') message(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketMessageDto) { return this.support.addMessage(u, id, dto.body); }
}
