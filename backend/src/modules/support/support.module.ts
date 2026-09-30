import { Global, Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Global()
@Module({ controllers: [SupportController], providers: [SupportService], exports: [SupportService] })
export class SupportModule {}
