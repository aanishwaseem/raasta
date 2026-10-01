import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class IdentityDto {
  @ApiProperty({ example: '35202-1234567-1' })
  @Matches(/^\d{5}-?\d{7}-?\d$/, { message: 'CNIC must be 13 digits (e.g. 35202-1234567-1)' })
  cnicNumber: string;
  @ApiProperty({ example: '1990-05-14' }) @IsDateString() dateOfBirth: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(30) licenseNumber: string;
  @ApiProperty() @IsUUID() cityId: string;
  @ApiPropertyOptional({ enum: ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] })
  @IsOptional()
  @IsIn(['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'])
  gender?: string;
}

export const VEHICLE_CLASSES = ['BIKE', 'ECONOMY', 'COMFORT', 'PREMIUM', 'XL'] as const;

export class VehicleDto {
  @ApiProperty({ enum: VEHICLE_CLASSES }) @IsIn(VEHICLE_CLASSES) vehicleClass: (typeof VEHICLE_CLASSES)[number];
  @ApiProperty({ example: 'Suzuki' }) @IsString() @MinLength(2) @MaxLength(40) make: string;
  @ApiProperty({ example: 'Cultus' }) @IsString() @MinLength(1) @MaxLength(40) model: string;
  @ApiProperty({ example: 2019 }) @Type(() => Number) @IsInt() @Min(1990) @Max(2100) year: number;
  @ApiProperty({ example: 'White' }) @IsString() @MinLength(3) @MaxLength(30) color: string;
  @ApiProperty({ example: 'LEA-19-1234' }) @IsString() @Matches(/^[A-Za-z0-9 -]{4,15}$/) plateNumber: string;
  @ApiProperty({ example: 4 }) @Type(() => Number) @IsInt() @Min(1) @Max(12) seats: number;
}

export const DOC_TYPES = ['CNIC_FRONT', 'CNIC_BACK', 'DRIVING_LICENSE', 'PROFILE_PHOTO', 'VEHICLE_REGISTRATION', 'VEHICLE_PHOTO', 'INSURANCE', 'ROUTE_PERMIT'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export class DocumentUploadDto {
  @ApiProperty({ enum: DOC_TYPES }) @IsIn(DOC_TYPES) docType: DocType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) documentNumber?: string;
  @ApiPropertyOptional({ example: '2028-12-31' }) @IsOptional() @IsDateString() expiresOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vehicleId?: string;
}

export class TrainingDto {
  @ApiProperty() @IsBoolean() acknowledged: boolean;
}

export class GoOnlineDto {
  @ApiProperty() @Type(() => Number) @IsLatitude() lat: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() lng: number;
}

export class LocationDto extends GoOnlineDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(360) heading?: number;
  @ApiPropertyOptional({ description: 'm/s' }) @IsOptional() @IsNumber() @Min(0) @Max(100) speed?: number;
  @ApiPropertyOptional({ description: 'metres' }) @IsOptional() @IsNumber() @Min(0) accuracy?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() recordedAt?: string;
}

export class DriverPreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() acceptShared?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(10) maxPickupKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() acceptIntercity?: boolean;
}

export class DeclineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reason?: string;
}

export class StartRideDto {
  @ApiProperty({ example: '4821' }) @Matches(/^\d{4}$/) pin: string;
}

export class DriverCancelDto {
  @ApiProperty({ enum: ['PASSENGER_NO_SHOW', 'PASSENGER_ASKED', 'VEHICLE_ISSUE', 'SAFETY_CONCERN', 'TOO_FAR', 'OTHER'] })
  @IsIn(['PASSENGER_NO_SHOW', 'PASSENGER_ASKED', 'VEHICLE_ISSUE', 'SAFETY_CONCERN', 'TOO_FAR', 'OTHER'])
  reason: string;
}

export class CompleteRideDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}

export class WithdrawalDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(500) @Max(500000) amount: number;
  @ApiProperty({ enum: ['BANK', 'JAZZCASH', 'EASYPAISA'] }) @IsIn(['BANK', 'JAZZCASH', 'EASYPAISA']) method: string;
  @ApiProperty({ description: 'IBAN or mobile wallet number' }) @IsString() @MinLength(8) @MaxLength(34) accountNumber: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) accountTitle: string;
}
