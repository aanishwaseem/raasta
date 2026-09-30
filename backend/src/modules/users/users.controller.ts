import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { config } from '../../config/config';
import { UsersService } from './users.service';
import {
  ConsentDto,
  EmergencyContactDto,
  PreferencesDto,
  SavedPlaceDto,
  UpdateEmergencyContactDto,
  UpdateMeDto,
  UpdateSavedPlaceDto,
} from './dto/users.dto';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() u: AuthUser) {
    return this.users.me(u.id);
  }

  @Patch()
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.update(u.id, dto);
  }

  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config().MAX_UPLOAD_BYTES } }))
  avatar(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.users.setAvatar(u.id, file);
  }

  @Get('avatar/:userId')
  async getAvatar(@Param('userId', ParseUUIDPipe) userId: string, @Res() res: Response) {
    const { data, type } = await this.users.avatar(userId);
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  }

  @Get('places')
  places(@CurrentUser() u: AuthUser) {
    return this.users.listPlaces(u.id);
  }
  @Post('places')
  addPlace(@CurrentUser() u: AuthUser, @Body() dto: SavedPlaceDto) {
    return this.users.addPlace(u.id, dto);
  }
  @Patch('places/:id')
  updatePlace(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSavedPlaceDto) {
    return this.users.updatePlace(u.id, id, dto);
  }
  @Delete('places/:id')
  @HttpCode(204)
  async deletePlace(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.deletePlace(u.id, id);
  }

  @Get('emergency-contacts')
  contacts(@CurrentUser() u: AuthUser) {
    return this.users.listContacts(u.id);
  }
  @Post('emergency-contacts')
  addContact(@CurrentUser() u: AuthUser, @Body() dto: EmergencyContactDto) {
    return this.users.addContact(u.id, dto);
  }
  @Patch('emergency-contacts/:id')
  updateContact(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmergencyContactDto) {
    return this.users.updateContact(u.id, id, dto);
  }
  @Delete('emergency-contacts/:id')
  @HttpCode(204)
  async deleteContact(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.deleteContact(u.id, id);
  }

  @Get('preferences')
  preferences(@CurrentUser() u: AuthUser) {
    return this.users.preferences(u.id);
  }
  @Patch('preferences')
  updatePreferences(@CurrentUser() u: AuthUser, @Body() dto: PreferencesDto) {
    return this.users.updatePreferences(u.id, dto);
  }

  @Get('consents')
  consents(@CurrentUser() u: AuthUser) {
    return this.users.consents(u.id);
  }
  @Post('consents')
  consent(@CurrentUser() u: AuthUser, @Body() dto: ConsentDto) {
    return this.users.recordConsent(u.id, dto);
  }

  @Get('export')
  export(@CurrentUser() u: AuthUser) {
    return this.users.export(u.id);
  }
}
