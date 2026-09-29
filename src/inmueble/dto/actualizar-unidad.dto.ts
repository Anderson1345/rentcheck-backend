import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TipoUnidad, UsoPermitido } from '@prisma/client';

export class ActualizarUnidadDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  nombre?: string;

  @IsOptional()
  @IsEnum(TipoUnidad)
  @ApiPropertyOptional()
  tipo?: TipoUnidad;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional()
  metros_cuadrados?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional()
  numero_habitaciones?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional()
  numero_banos?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional()
  canon_base_centavos?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional()
  ocupantes_maximos?: number;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  acepta_mascotas?: boolean;

  @IsOptional()
  @IsEnum(UsoPermitido)
  @ApiPropertyOptional()
  uso_permitido?: UsoPermitido;
}
