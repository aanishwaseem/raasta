import { Body, Controller, Delete, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, ReqMeta, RequestMeta } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { DeleteAccountDto } from '../users/dto/users.dto';
import { AuthService } from './auth.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete my account (irreversible). Body must be {"confirm":"DELETE"}.' })
  async delete(@CurrentUser() u: AuthUser, @Body() _dto: DeleteAccountDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.deleteAccount(u.id, meta);
  }
}
