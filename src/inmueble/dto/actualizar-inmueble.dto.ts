import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ActualizarInmuebleDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  direccion?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  ciudad?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  @ApiPropertyOptional()
  estrato?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  matricula_inmobiliaria?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  foto_portada_url?: string;
}
