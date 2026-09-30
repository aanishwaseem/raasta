import { Global, Module } from '@nestjs/common';
import { config } from '../../config/config';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { HaversineRoutingProvider, OsrmRoutingProvider, RoutingProvider } from './routing.provider';

@Global()
@Module({
  controllers: [GeoController],
  providers: [
    GeoService,
    { provide: RoutingProvider, useClass: config().ROUTING_PROVIDER === 'osrm' ? OsrmRoutingProvider : HaversineRoutingProvider },
  ],
  exports: [GeoService, RoutingProvider],
})
export class GeoModule {}
