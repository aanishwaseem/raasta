import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PlaceInputDto } from '../../../common/dto';

export class AddEmployeeDto {
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional({ default: 0, description: 'PKR per month, 0 = no personal cap' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) monthlyLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) employeeCode?: string;
  @ApiPropertyOptional({ enum: ['EMPLOYEE', 'ADMIN'] }) @IsOptional() @IsIn(['EMPLOYEE', 'ADMIN']) role?: 'EMPLOYEE' | 'ADMIN';
}
export class UpdateEmployeeDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) monthlyLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ enum: ['EMPLOYEE', 'ADMIN'] }) @IsOptional() @IsIn(['EMPLOYEE', 'ADMIN']) role?: 'EMPLOYEE' | 'ADMIN';
}
export class PolicyDto {
  @ApiProperty({ example: ['ECONOMY', 'COMFORT'] }) @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) allowedProducts: string[];
  @ApiProperty({ description: '0 = no cap' }) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) maxFarePerRide: number;
  @ApiProperty({ example: [1, 2, 3, 4, 5] }) @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) allowedWeekdays: number[];
  @ApiProperty({ example: '06:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) allowedStart: string;
  @ApiProperty({ example: '22:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) allowedEnd: string;
  @ApiProperty() @IsBoolean() requirePurpose: boolean;
}
export class BudgetDto {
  @ApiProperty({ description: 'PKR per month, 0 = unlimited' }) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000) monthlyBudget: number;
}
export class CorporateScheduleDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) pickup: PlaceInputDto;
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) dropoff: PlaceInputDto;
  @ApiProperty() @IsString() @MaxLength(20) productCode: string;
  @ApiProperty({ description: 'ISO 8601' }) @IsString() pickupAt: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) tripPurpose?: string;
}
