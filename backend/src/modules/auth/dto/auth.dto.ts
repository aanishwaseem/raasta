import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DeviceDto {
  @ApiProperty({ example: '6f1c1d3e-device' }) @IsString() @Length(4, 128) deviceId: string;
  @ApiPropertyOptional({ example: 'Pixel 7' }) @IsOptional() @IsString() @MaxLength(100) deviceName?: string;
  @ApiPropertyOptional({ enum: ['android', 'ios', 'web'] }) @IsOptional() @IsIn(['android', 'ios', 'web']) platform?: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'Ayesha Khan' }) @IsString() @MinLength(2) @MaxLength(80) fullName: string;
  @ApiPropertyOptional({ example: 'ayesha@example.com' }) @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ example: '+923001234567' }) @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'password must contain letters and numbers' })
  password: string;
  @ApiProperty({ enum: ['PASSENGER', 'DRIVER'] }) @IsIn(['PASSENGER', 'DRIVER']) role: 'PASSENGER' | 'DRIVER';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) referralCode?: string;
  @ApiProperty({ type: DeviceDto }) @ValidateNested() @Type(() => DeviceDto) device: DeviceDto;
}

export class LoginDto {
  @ApiProperty({ description: 'email or phone' }) @IsString() @IsNotEmpty() @MaxLength(254) identifier: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(128) password: string;
  @ApiProperty({ type: DeviceDto }) @ValidateNested() @Type(() => DeviceDto) device: DeviceDto;
}

export class OtpRequestDto {
  @ApiProperty({ example: '+923001234567' }) @IsString() @MaxLength(20) phone: string;
  @ApiPropertyOptional({ enum: ['LOGIN', 'VERIFY_PHONE'], default: 'LOGIN' })
  @IsOptional()
  @IsIn(['LOGIN', 'VERIFY_PHONE'])
  purpose: 'LOGIN' | 'VERIFY_PHONE' = 'LOGIN';
}

export class OtpVerifyDto {
  @ApiProperty() @IsString() @MaxLength(20) phone: string;
  @ApiProperty({ example: '123456' }) @IsString() @Length(6, 6) code: string;
  @ApiPropertyOptional({ description: 'required when the phone has no account yet' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fullName?: string;
  @ApiPropertyOptional({ enum: ['PASSENGER', 'DRIVER'] }) @IsOptional() @IsIn(['PASSENGER', 'DRIVER']) role?: 'PASSENGER' | 'DRIVER';
  @ApiProperty({ type: DeviceDto }) @ValidateNested() @Type(() => DeviceDto) device: DeviceDto;
}

export class OAuthDto {
  @ApiProperty({ enum: ['GOOGLE', 'APPLE'] }) @IsIn(['GOOGLE', 'APPLE']) provider: 'GOOGLE' | 'APPLE';
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4096) idToken: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) fullName?: string;
  @ApiPropertyOptional({ enum: ['PASSENGER', 'DRIVER'] }) @IsOptional() @IsIn(['PASSENGER', 'DRIVER']) role?: 'PASSENGER' | 'DRIVER';
  @ApiProperty({ type: DeviceDto }) @ValidateNested() @Type(() => DeviceDto) device: DeviceDto;
}

export class RefreshDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) refreshToken: string;
}

export class TokensDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ description: 'access token lifetime in seconds' }) expiresIn: number;
}
