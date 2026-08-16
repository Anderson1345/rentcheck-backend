import { TipoPlantillaContrato } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CrearContratoDto {
  @IsString()
  @IsNotEmpty()
  unidad_id!: string;

  @IsString()
  @IsNotEmpty()
  inquilino_id!: string;

  @IsEnum(TipoPlantillaContrato)
  tipo_plantilla!: TipoPlantillaContrato;

  @IsInt()
  canon_centavos!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dia_pago!: number;

  @IsString()
  @IsNotEmpty()
  forma_pago!: string;

  @IsInt()
  deposito_centavos!: number;

  @IsString()
  @IsNotEmpty()
  datos_recaudo!: string;

  @IsOptional()
  @IsString()
  datos_fiador_o_poliza?: string;

  @IsOptional()
  @IsString()
  condicionesParticularesTexto?: string;

  @Type(() => Date)
  @IsDate()
  fecha_inicio!: Date;

  @Type(() => Date)
  @IsDate()
  fecha_fin!: Date;
}
