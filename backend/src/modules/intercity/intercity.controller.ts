import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { Idempotent } from '../../common/idempotency/idempotency';
import { IntercityService } from './intercity.service';

class TripsQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() routeId?: string;
  @ApiPropertyOptional({ example: '2026-10-05' }) @IsOptional() @IsDateString() date?: string;
}
class PostTripDto {
  @ApiProperty() @IsUUID() routeId: string;
  @ApiProperty() @IsISO8601() departureAt: string;
  @ApiProperty() @IsString() @MaxLength(120) pickupPoint: string;
  @ApiProperty() @IsString() @MaxLength(120) dropoffPoint: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(11) seatsTotal: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(100) @Max(20000) seatFare: number;
  @ApiProperty({ enum: ['NONE', 'ONE_BAG', 'TWO_BAGS', 'LARGE_ALLOWED'] }) @IsIn(['NONE', 'ONE_BAG', 'TWO_BAGS', 'LARGE_ALLOWED']) luggagePolicy: 'NONE' | 'ONE_BAG' | 'TWO_BAGS' | 'LARGE_ALLOWED';
}
class BookDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(6) seats: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(12) luggageCount?: number;
}

@ApiTags('intercity')
@ApiBearerAuth()
@Controller()
export class IntercityController {
  constructor(private readonly intercity: IntercityService) {}

  @Get('intercity/routes') routes() { return this.intercity.routes(); }
  @Get('intercity/trips') trips(@Query() q: TripsQuery) { return this.intercity.trips(q); }

  @Post('intercity/trips/:id/book')
  @Roles('PASSENGER')
  @Idempotent('intercity-book')
  book(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BookDto) {
    return this.intercity.book(u.id, id, dto);
  }
  @Get('intercity/bookings') @Roles('PASSENGER') bookings(@CurrentUser() u: AuthUser) { return this.intercity.myBookings(u.id); }
  @Delete('intercity/bookings/:id') @Roles('PASSENGER') cancelBooking(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.intercity.cancelBooking(u.id, id); }

  @Post('driver/intercity/trips') @Roles('DRIVER') post(@CurrentUser() u: AuthUser, @Body() dto: PostTripDto) { return this.intercity.postTrip(u.id, dto); }
  @Get('driver/intercity/trips') @Roles('DRIVER') mine(@CurrentUser() u: AuthUser) { return this.intercity.myTrips(u.id); }
  @Delete('driver/intercity/trips/:id') @Roles('DRIVER') cancelTrip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.intercity.cancelTrip(u.id, id); }
}
