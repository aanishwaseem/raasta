import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { AssistantService } from './assistant.service';
import { MobilityService } from './mobility.service';
import { AssistantMessageDto, ConfirmActionDto, PersonalizationDto, VoiceParseDto } from './dto/assistant.dto';

const loc = (d: { lat?: number; lng?: number }) => (d.lat !== undefined && d.lng !== undefined ? { lat: d.lat, lng: d.lng } : undefined);

@ApiTags('assistant')
@ApiBearerAuth()
@Roles('PASSENGER')
@Controller()
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly mobility: MobilityService,
  ) {}

  @Post('assistant/message')
  @HttpCode(200)
  @RateLimit({ name: 'assistant', limit: 30, windowSec: 60, by: 'user' })
  message(@CurrentUser() u: AuthUser, @Body() dto: AssistantMessageDto) {
    return this.assistant.message(u, dto.text, { loc: loc(dto), locale: dto.locale });
  }

  @Post('assistant/confirm')
  @HttpCode(200)
  @RateLimit({ name: 'assistant-confirm', limit: 10, windowSec: 60, by: 'user' })
  confirm(@CurrentUser() u: AuthUser, @Body() dto: ConfirmActionDto) {
    return this.assistant.confirm(u, dto.token, dto.paymentMethod);
  }

  @Post('voice/parse')
  @HttpCode(200)
  @RateLimit({ name: 'voice', limit: 30, windowSec: 60, by: 'user' })
  voice(@CurrentUser() u: AuthUser, @Body() dto: VoiceParseDto) {
    return this.assistant.voiceParse(u, dto.transcript, { loc: loc(dto), locale: dto.locale });
  }

  @Get('me/suggestions')
  suggestions(@CurrentUser() u: AuthUser) {
    return this.mobility.suggestions(u.id);
  }

  @Get('me/personalization')
  async personalization(@CurrentUser() u: AuthUser) {
    return (await this.mobility.profile(u.id)) && this.mobility.refresh(u.id).then((r) => r ?? this.mobility.profile(u.id));
  }

  @Patch('me/personalization')
  setPersonalization(@CurrentUser() u: AuthUser, @Body() dto: PersonalizationDto) {
    return this.mobility.setEnabled(u.id, dto.enabled);
  }

  @Delete('me/personalization')
  deletePersonalization(@CurrentUser() u: AuthUser) {
    return this.mobility.deleteProfile(u.id);
  }

  @Get('me/stats')
  stats(@CurrentUser() u: AuthUser) {
    return this.mobility.stats(u.id);
  }
}
