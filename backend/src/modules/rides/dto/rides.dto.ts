import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LatLngDto, PageQuery, PlaceInputDto } from '../../../common/dto';

export class QuoteRequestDto {
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) pickup: PlaceInputDto;
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) dropoff: PlaceInputDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) promoCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() corporateId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(6) seats?: number;
}

export const PAYMENT_METHODS = ['CASH', 'WALLET', 'CARD', 'CORPORATE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class RideRequestDto {
  @ApiProperty() @IsUUID() quoteId: string;
  @ApiProperty({ example: 'ECONOMY' }) @IsString() @MaxLength(20) productCode: string;
  @ApiPropertyOptional({ description: 'Passenger offer in PKR; defaults to the recommended fare' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(100000)
  offeredFare?: number;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) paymentMethod: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) promoCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() corporateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) tripPurpose?: string;
  @ApiPropertyOptional({ description: "women's safety mode / enhanced monitoring for this ride" }) @IsOptional() @IsBoolean() safetyMode?: boolean;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(6) seats?: number;
}

export const CANCEL_REASONS = ['CHANGED_MIND', 'DRIVER_TOO_FAR', 'WAIT_TOO_LONG', 'WRONG_PICKUP', 'FOUND_OTHER_RIDE', 'DRIVER_ASKED', 'SAFETY_CONCERN', 'OTHER'] as const;

export class CancelRideDto {
  @ApiProperty({ enum: CANCEL_REASONS }) @IsIn(CANCEL_REASONS) reason: string;
}

export const RATING_TAGS = [
  'SAFE_DRIVING',
  'CLEAN_VEHICLE',
  'POLITE',
  'ON_TIME',
  'GOOD_NAVIGATION',
  'RASH_DRIVING',
  'RUDE',
  'LATE',
  'DIRTY_VEHICLE',
  'WRONG_ROUTE',
  'FELT_UNSAFE',
  'RESPECTFUL',
  'READY_AT_PICKUP',
  'KEPT_WAITING',
  'DAMAGED_VEHICLE',
] as const;

export class RatingDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) stars: number;
  @ApiPropertyOptional({ enum: RATING_TAGS, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(6) @IsIn(RATING_TAGS, { each: true }) tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class ShareRideDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) emergencyContactIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
}

export class SosDto {
  @ApiPropertyOptional({ type: LatLngDto }) @IsOptional() @ValidateNested() @Type(() => LatLngDto) location?: LatLngDto;
}

export class SafetyResponseDto {
  @ApiProperty({ enum: ['SAFE', 'CONTACT_DRIVER', 'SHARE', 'SOS'] }) @IsIn(['SAFE', 'CONTACT_DRIVER', 'SHARE', 'SOS']) response: 'SAFE' | 'CONTACT_DRIVER' | 'SHARE' | 'SOS';
}

export class RideHistoryQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'COMPLETED', 'CANCELLED'] }) @IsOptional() @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED']) status?: string;
  @ApiPropertyOptional({ enum: ['PASSENGER', 'DRIVER'] }) @IsOptional() @IsIn(['PASSENGER', 'DRIVER']) as?: 'PASSENGER' | 'DRIVER';
}
