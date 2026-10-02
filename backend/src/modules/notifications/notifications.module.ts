import { Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { PageQuery } from '../../common/dto';
import { DevicesController } from './devices.controller';
import { NotificationsService } from './notifications.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: PageQuery) {
    return this.notifications.list(u.id, q);
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() u: AuthUser) {
    await this.notifications.markAllRead(u.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(u.id, id);
  }
}

@Global()
@Module({
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
