import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Public } from '../../common/auth/decorators';
import { LatLngDto } from '../../common/dto';
import { GeoService } from './geo.service';

class SearchQuery {
  @ApiPropertyOptional() @IsString() @MaxLength(100) q: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}

class PointQuery extends LatLngDto {
  @Type(() => Number) declare lat: number;
  @Type(() => Number) declare lng: number;
}

@ApiTags('geo')
@Controller()
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Public()
  @Get('cities')
  cities() {
    return this.geo.cities();
  }

  @ApiBearerAuth()
  @Get('places/search')
  search(@Query() q: SearchQuery) {
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return this.geo.searchPlaces(q.q, near, q.cityId);
  }

  @ApiBearerAuth()
  @Get('places/reverse')
  reverse(@Query() q: PointQuery) {
    return this.geo.reverse(q);
  }

  @Public()
  @Get('geo/service-check')
  async serviceCheck(@Query() q: PointQuery) {
    const area = await this.geo.serviceAreaAt(q);
    const restricted = await this.geo.isRestricted(q);
    return { serviceable: !!area && !restricted, cityId: area?.cityId ?? null, areaName: area?.areaName ?? null };
  }
}
