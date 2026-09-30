import { Module } from '@nestjs/common';
import { RidesController, SafetyController } from './rides.controller';

@Module({ controllers: [RidesController, SafetyController] })
export class RidesModule {}
