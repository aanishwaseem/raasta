import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, ReqMeta, RequestMeta } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { AuthService } from './auth.service';
import { LoginDto, OAuthDto, OtpRequestDto, OtpVerifyDto, RefreshDto, RegisterDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @RateLimit({ name: 'register-ip', limit: 10, windowSec: 3600, by: 'ip' })
  @ApiOperation({ summary: 'Register with email and/or phone + password' })
  register(@Body() dto: RegisterDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.register(dto, meta);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit({ name: 'login-ip', limit: 20, windowSec: 300, by: 'ip' }, { name: 'login-id', limit: 8, windowSec: 300, by: 'body:identifier' })
  login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(dto, meta);
  }

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  @RateLimit(
    { name: 'otp-phone-min', limit: 1, windowSec: 30, by: 'body:phone' },
    { name: 'otp-phone-hour', limit: 10, windowSec: 3600, by: 'body:phone' },
    { name: 'otp-ip', limit: 30, windowSec: 3600, by: 'ip' },
  )
  @ApiOperation({ summary: 'Send a one-time code by SMS' })
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @RateLimit({ name: 'otp-verify-phone', limit: 10, windowSec: 600, by: 'body:phone' })
  verifyOtp(@Body() dto: OtpVerifyDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.verifyOtp(dto, meta);
  }

  @Public()
  @Post('oauth')
  @HttpCode(200)
  @RateLimit({ name: 'oauth-ip', limit: 30, windowSec: 300, by: 'ip' })
  @ApiOperation({ summary: 'Sign in with a Google or Apple ID token' })
  oauth(@Body() dto: OAuthDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.oauth(dto, meta);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit({ name: 'refresh-ip', limit: 60, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Rotate the refresh token and get a new access token' })
  refresh(@Body() dto: RefreshDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user.sid);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Sign out of every device' })
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.logoutAll(user.id);
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id, user.sid);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(user.id, id);
  }
}
