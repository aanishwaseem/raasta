import { Module } from '@nestjs/common';
import { CorporateController } from './corporate.controller';
import { CorporateService } from './corporate.service';

@Module({ controllers: [CorporateController], providers: [CorporateService] })
export class CorporateModule {}
