import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQuery } from '../../../common/dto';

export class ReasonDto {
  @ApiProperty({ description: 'Required for every admin action; stored in the audit log' }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
export class UserListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional({ enum: ['PASSENGER', 'DRIVER', 'ADMIN', 'SUPPORT', 'CORPORATE_ADMIN'] }) @IsOptional() @IsString() @MaxLength(40) role?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'DELETED'] }) @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED', 'DELETED']) status?: string;
}
export class DriverListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['ONBOARDING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'] }) @IsOptional() @IsString() @MaxLength(40) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string;
}
export class RideListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) q?: string;
}
export class StatusFilterQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) level?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) priority?: string;
}
export class ReviewDocumentDto extends ReasonDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
}
export class ReviewVehicleDto extends ReasonDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
}
export class ProcessWithdrawalDto {
  @ApiProperty({ enum: ['PAID', 'REJECTED'] }) @IsIn(['PAID', 'REJECTED']) decision: 'PAID' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class CancelRideAdminDto extends ReasonDto {}
export class ResolveSafetyDto {
  @ApiProperty({ enum: ['RESOLVED', 'FALSE_POSITIVE', 'ESCALATED'] }) @IsIn(['RESOLVED', 'FALSE_POSITIVE', 'ESCALATED']) status: 'RESOLVED' | 'FALSE_POSITIVE' | 'ESCALATED';
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) note: string;
}
export class ReviewFraudDto {
  @ApiProperty({ enum: ['DISMISSED', 'ACTIONED'] }) @IsIn(['DISMISSED', 'ACTIONED']) decision: 'DISMISSED' | 'ACTIONED';
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) note: string;
}
export class UpdateTicketDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedTo?: string;
}
export class PromotionDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9]{4,20}$/) code: string;
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiProperty({ enum: ['PROMO', 'FIRST_RIDE', 'CORPORATE', 'CAMPAIGN', 'REFERRAL'] }) @IsIn(['PROMO', 'FIRST_RIDE', 'CORPORATE', 'CAMPAIGN', 'REFERRAL']) kind: string;
  @ApiProperty({ enum: ['PERCENT', 'FLAT'] }) @IsIn(['PERCENT', 'FLAT']) discountType: 'PERCENT' | 'FLAT';
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(100000) discountValue: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxDiscount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) minFare?: number;
  @ApiProperty() @IsISO8601() startsAt: string;
  @ApiProperty() @IsISO8601() endsAt: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) usageLimitTotal?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) usageLimitPerUser?: number;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) productCodes?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) cityIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() newUsersOnly?: boolean;
}
export class PromotionPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) usageLimitTotal?: number;
}
export class PricingUpdateDto extends ReasonDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(5000) baseFare: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) @Max(1000) perKm: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) @Max(100) perMinute: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10000) minimumFare: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(500) bookingFee: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) @Max(40) platformFeePct: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) @Max(200) fuelCostPerKm: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(1) @Max(3) maxSurgeMultiplier: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(50) @Max(100) minOfferPct: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) @Max(60) sharedDiscountPct: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(2000) cancellationFee: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(900) freeCancelSeconds: number;
}
export class CityDto {
  @ApiProperty() @IsString() @Matches(/^[a-z-]{3,30}$/) slug: string;
  @ApiProperty() @IsString() @MaxLength(60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) nameUr?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() lat: number;
  @ApiProperty() @Type(() => Number) @IsNumber() lng: number;
}
export class CityPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) name?: string;
}
export class ModelActivateDto extends ReasonDto {}
export class TrainDto {
  @ApiProperty({ example: ['eta', 'demand', 'cancellation'] }) @IsArray() @ArrayMaxSize(5) @IsIn(['eta', 'demand', 'cancellation', 'fraud'], { each: true }) models: string[];
}
export class AuditQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
}
export class RangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) metric?: string;
  @ApiPropertyOptional({ enum: ['hour', 'day'] }) @IsOptional() @IsIn(['hour', 'day']) interval?: 'hour' | 'day';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) includeTestData?: string;
}
export class CityQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
}
export class CorporateAccountDto {
  @ApiProperty() @IsString() @MaxLength(100) name: string;
  @ApiProperty({ enum: ['SOFTWARE', 'FACTORY', 'UNIVERSITY', 'HOSPITAL', 'OFFICE', 'OTHER'] }) @IsIn(['SOFTWARE', 'FACTORY', 'UNIVERSITY', 'HOSPITAL', 'OFFICE', 'OTHER']) industry: string;
  @ApiProperty() @IsString() @MaxLength(120) billingEmail: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) monthlyBudget?: number;
  @ApiProperty({ description: 'Email of an existing user who will administer the account' }) @IsString() @MaxLength(120) adminEmail: string;
}
export class CorporateAccountPatchDto extends ReasonDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) monthlyBudget?: number;
}

export class StaffReplyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) body: string;
}
/** Polygon ring as [lng, lat] pairs. */
const polygonDecorators = () => (target: object, key: string) => {
  IsArray()(target, key);
  ArrayMinSize(3)(target, key);
  ArrayMaxSize(1000)(target, key);
  IsArray({ each: true })(target, key);
  ArrayMinSize(2, { each: true })(target, key);
  ArrayMaxSize(2, { each: true })(target, key);
};
export class ZoneCreateDto {
  @ApiProperty() @IsUUID() cityId: string;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{2,30}$/) code: string;
  @ApiProperty() @IsString() @MaxLength(80) name: string;
  @ApiProperty({ description: '[lng, lat] pairs' }) @polygonDecorators() polygon: number[][];
}
export class ZonePatchDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
}
export class ServiceAreaCreateDto {
  @ApiProperty() @IsUUID() cityId: string;
  @ApiProperty() @IsString() @MaxLength(80) name: string;
  @ApiProperty({ enum: ['SERVICE', 'AIRPORT', 'RESTRICTED'] }) @IsIn(['SERVICE', 'AIRPORT', 'RESTRICTED']) kind: 'SERVICE' | 'AIRPORT' | 'RESTRICTED';
  @ApiProperty({ description: '[lng, lat] pairs' }) @polygonDecorators() polygon: number[][];
}
export class ServiceAreaPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
