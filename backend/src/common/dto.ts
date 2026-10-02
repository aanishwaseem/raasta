import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class LatLngDto {
  @ApiProperty({ example: 31.5204 }) @IsNumber() @IsLatitude() lat: number;
  @ApiProperty({ example: 74.3587 }) @IsNumber() @IsLongitude() lng: number;
}

export class PlaceInputDto extends LatLngDto {
  @ApiProperty({ example: 'Liberty Market, Gulberg III, Lahore' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  address: string;
}

export class PageQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const offsetOf = (q: PageQuery) => (q.page - 1) * q.pageSize;

/** Converts a PostGIS geography column to lat/lng in SQL: use with `${latLngSql('pickup')}` in selects. */
export const latLngSql = (col: string, alias = col) =>
  `json_build_object('lat', ST_Y(${col}::geometry), 'lng', ST_X(${col}::geometry)) AS ${alias}`;
