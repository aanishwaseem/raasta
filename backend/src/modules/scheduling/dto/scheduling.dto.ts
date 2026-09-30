import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PlaceInputDto } from '../../../common/dto';
import { PAYMENT_METHODS, PaymentMethod } from '../../rides/dto/rides.dto';

export class ScheduleRideDto {
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) pickup: PlaceInputDto;
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) dropoff: PlaceInputDto;
  @ApiProperty({ example: 'ECONOMY' }) @IsString() @MaxLength(20) productCode: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) paymentMethod: PaymentMethod;
  @ApiPropertyOptional({ description: 'Exact pickup time (ISO 8601). Provide this or targetArrivalAt.' }) @IsOptional() @IsISO8601() pickupAt?: string;
  @ApiPropertyOptional({ description: 'Be at the destination by this time; pickup time is derived from the predicted trip time.' }) @IsOptional() @IsISO8601() targetArrivalAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() preferredDriverId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() corporateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) tripPurpose?: string;
}

export class RecurringRideDto {
  @ApiProperty({ example: 'Office commute' }) @IsString() @MaxLength(60) label: string;
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) pickup: PlaceInputDto;
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) dropoff: PlaceInputDto;
  @ApiProperty() @IsString() @MaxLength(20) productCode: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) paymentMethod: PaymentMethod;
  @ApiProperty({ example: [1, 2, 3, 4, 5], description: 'ISO weekdays, 1 = Monday' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek: number[];
  @ApiPropertyOptional({ example: '08:15', description: 'Pakistan local time' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) pickupTime?: string;
  @ApiPropertyOptional({ example: '09:00' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) targetArrivalTime?: string;
  @ApiPropertyOptional({ description: 'Explicit permission to request the ride automatically. Without it you get a reminder to confirm.' })
  @IsOptional()
  @IsBoolean()
  autoDispatch?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() preferredDriverId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() corporateId?: string;
}
