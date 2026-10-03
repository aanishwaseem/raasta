import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { DatabaseService } from '../../common/db/database.service';

class RegisterDeviceDto {
  @ApiProperty({ enum: ['android', 'ios', 'web'] }) @IsIn(['android', 'ios', 'web']) platform: string;
  @ApiProperty({ description: 'FCM registration token from the Firebase SDK on the device' }) @IsString() @MinLength(20) @MaxLength(4096) token: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(128) deviceId?: string;
}
class UnregisterDeviceDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(4096) token: string;
}

/** Push token registration. A token belongs to the user who registered it last (shared phones, re-installs). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/devices')
export class DevicesController {
  constructor(private readonly db: DatabaseService) {}

  @Post()
  @HttpCode(204)
  async register(@CurrentUser() u: AuthUser, @Body() dto: RegisterDeviceDto) {
    await this.db.query(
      `INSERT INTO push_devices (user_id, platform, token, device_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, device_id = EXCLUDED.device_id, last_seen_at = now()`,
      [u.id, dto.platform, dto.token, dto.deviceId ?? null],
    );
  }

  @Delete()
  @HttpCode(204)
  async unregister(@CurrentUser() u: AuthUser, @Body() dto: UnregisterDeviceDto) {
    await this.db.query(`DELETE FROM push_devices WHERE token = $1 AND user_id = $2`, [dto.token, u.id]);
  }
}
