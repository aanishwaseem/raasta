import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { LatLngDto, PageQuery, PlaceInputDto } from '../../../common/dto';

export const PACKAGE_CATEGORIES = ['DOCUMENTS', 'FOOD', 'PARCEL', 'FRAGILE', 'GROCERY', 'OTHER'] as const;

export class DeliveryQuoteDto {
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) pickup: PlaceInputDto;
  @ApiProperty({ type: PlaceInputDto }) @ValidateNested() @Type(() => PlaceInputDto) dropoff: PlaceInputDto;
  @ApiProperty({ example: 2.5 }) @Type(() => Number) @IsNumber() @Min(0.1) @Max(100) weightKg: number;
}

export class CreateDeliveryDto extends DeliveryQuoteDto {
  @ApiProperty({ enum: PACKAGE_CATEGORIES }) @IsIn(PACKAGE_CATEGORIES as unknown as string[]) packageCategory: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) packageDescription?: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) recipientName: string;
  @ApiProperty({ example: '+923001234567' }) @IsString() @MaxLength(20) recipientPhone: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) pickupContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) pickupContactPhone?: string;
  @ApiProperty({ description: 'Fare the sender saw in the quote; the order is rejected if the server price differs' }) @Type(() => Number) @IsNumber() @Min(0) expectedFare: number;
}

export class DeliveryCancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
export class DeliverDto {
  @ApiProperty({ description: 'PIN read out by the recipient' }) @Matches(/^\d{4}$/) pin: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class OpenDeliveriesQuery extends PageQuery implements Partial<LatLngDto> {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() lng?: number;
}
