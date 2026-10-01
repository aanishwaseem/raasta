import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AssistantMessageDto {
  @ApiProperty({ example: 'Johar Town se Liberty jana hai kal subah 8 baje' }) @IsString() @MinLength(1) @MaxLength(500) text: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @ApiPropertyOptional({ enum: ['en', 'ur'] }) @IsOptional() @IsIn(['en', 'ur']) locale?: string;
}

export class VoiceParseDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) transcript: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @ApiPropertyOptional({ enum: ['en', 'ur'] }) @IsOptional() @IsIn(['en', 'ur']) locale?: string;
}

export class ConfirmActionDto {
  @ApiProperty() @IsString() @MinLength(16) @MaxLength(100) token: string;
  @ApiPropertyOptional({ enum: ['CASH', 'WALLET', 'CARD'] }) @IsOptional() @IsIn(['CASH', 'WALLET', 'CARD']) paymentMethod?: 'CASH' | 'WALLET' | 'CARD';
}

export class PersonalizationDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}
