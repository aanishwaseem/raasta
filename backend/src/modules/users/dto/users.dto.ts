import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { LatLngDto } from '../../../common/dto';

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ enum: ['en', 'ur'] }) @IsOptional() @IsIn(['en', 'ur']) locale?: string;
  @ApiPropertyOptional({ enum: ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] })
  @IsOptional()
  @IsIn(['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'])
  gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() homeCityId?: string;
}

export class SavedPlaceDto extends LatLngDto {
  @ApiProperty({ enum: ['HOME', 'WORK', 'FAVORITE'] }) @IsIn(['HOME', 'WORK', 'FAVORITE']) label: 'HOME' | 'WORK' | 'FAVORITE';
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
}

export class UpdateSavedPlaceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional({ type: LatLngDto }) @IsOptional() @ValidateNested() @Type(() => LatLngDto) location?: LatLngDto;
}

export class EmergencyContactDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ example: '+923001112233' }) @IsString() @MaxLength(20) phone: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) relationship?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() shareByDefault?: boolean;
}

export class UpdateEmergencyContactDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) relationship?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() shareByDefault?: boolean;
}

export class SafetyPreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoShareWithContacts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() routeDeviationAlerts?: boolean;
  @ApiPropertyOptional({ description: 'Honoured when supply allows; never guaranteed' }) @IsOptional() @IsBoolean() preferFemaleDriver?: boolean;
}

export class NotificationPreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() push?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sms?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() email?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marketing?: boolean;
}

export class PreferencesDto {
  @ApiPropertyOptional({ type: SafetyPreferencesDto }) @IsOptional() @ValidateNested() @Type(() => SafetyPreferencesDto) safety?: SafetyPreferencesDto;
  @ApiPropertyOptional({ type: NotificationPreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  notifications?: NotificationPreferencesDto;
}

export class ConsentDto {
  @ApiProperty({ enum: ['LOCATION', 'PERSONALIZATION', 'MARKETING', 'TERMS', 'RECURRING_AUTO_DISPATCH'] })
  @IsIn(['LOCATION', 'PERSONALIZATION', 'MARKETING', 'TERMS', 'RECURRING_AUTO_DISPATCH'])
  kind: string;
  @ApiProperty() @IsBoolean() granted: boolean;
}

export class DeleteAccountDto {
  @ApiProperty({ example: 'DELETE' }) @IsIn(['DELETE']) confirm: 'DELETE';
}
