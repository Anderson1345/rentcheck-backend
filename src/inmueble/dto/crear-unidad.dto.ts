import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
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

  @IsNumber()
  @Min(1)
  metros_cuadrados!: number;

  @IsInt()
  @Min(0)
  numero_habitaciones!: number;

  @IsInt()
  @Min(0)
  numero_banos!: number;

  @IsInt()
  @Min(0)
  canon_base_centavos!: number;

  @IsInt()
  @Min(1)
  ocupantes_maximos!: number;

  @IsBoolean()
  acepta_mascotas!: boolean;

  @IsEnum(UsoPermitido)
  uso_permitido!: UsoPermitido;
}
