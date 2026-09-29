import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TipoUnidad, UsoPermitido } from '@prisma/client';

export class CrearUnidadDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsEnum(TipoUnidad)
  tipo!: TipoUnidad;

  /** Obligatorio (>= 1) si el uso es RESIDENCIAL; opcional si es COMERCIAL. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  metros_cuadrados?: number;

  /** Obligatorio si el uso es RESIDENCIAL. */
  @IsOptional()
  @IsInt()
  @Min(0)
  numero_habitaciones?: number;

  /** Obligatorio si el uso es RESIDENCIAL. */
  @IsOptional()
  @IsInt()
  @Min(0)
  numero_banos?: number;

  @IsInt()
  @Min(0)
  canon_base_centavos!: number;

  /** Obligatorio (>= 1) si el uso es RESIDENCIAL. */
  @IsOptional()
  @IsInt()
  @Min(0)
  ocupantes_maximos?: number;

  @IsBoolean()
  acepta_mascotas!: boolean;

  @IsEnum(UsoPermitido)
  uso_permitido!: UsoPermitido;
}
