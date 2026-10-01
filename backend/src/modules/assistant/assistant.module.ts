import { Global, Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { MobilityService } from './mobility.service';

@Global()
@Module({ controllers: [AssistantController], providers: [AssistantService, MobilityService], exports: [AssistantService, MobilityService] })
export class AssistantModule {}
