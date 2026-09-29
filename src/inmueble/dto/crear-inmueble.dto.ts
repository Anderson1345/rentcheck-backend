import { UsoPermitido } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CrearInmuebleDto {
  @IsString()
  @IsNotEmpty()
  direccion!: string;

  @IsString()
  @IsNotEmpty()
  ciudad!: string;

  /** Obligatorio si la unidad principal es residencial (regla 6). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  estrato?: number;

  @IsString()
  @IsNotEmpty()
  matricula_inmobiliaria!: string;

  /** Uso de la unidad principal automática. Por defecto RESIDENCIAL. */
  @IsOptional()
  @IsEnum(UsoPermitido)
  uso_unidad_principal?: UsoPermitido;
}
