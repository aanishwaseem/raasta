import { Module } from '@nestjs/common';
import { IntercityController } from './intercity.controller';
import { IntercityService } from './intercity.service';

@Module({ controllers: [IntercityController], providers: [IntercityService] })
export class IntercityModule {}
