import { TipoPlantillaContrato } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { FechaFinPosteriorAFechaInicio } from '../../common/validadores-fecha';
import { CrearInquilinoDto } from '../../inquilino/dto/crear-inquilino.dto';

export class CrearContratoDto {
  @IsString()
  @IsNotEmpty()
  unidad_id!: string;

  /**
   * Inquilino que ya tiene un contrato con este arrendador (o una ficha
   * propia de `POST /inquilinos`). Exactamente uno de `inquilino_id` o
   * `inquilino_nuevo`.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  inquilino_id?: string;

  /**
   * Datos del inquilino tal como los escribe el arrendador. Se busca la
   * persona por cédula normalizada y se reutiliza sin modificarla.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CrearInquilinoDto)
  inquilino_nuevo?: CrearInquilinoDto;

  @IsEnum(TipoPlantillaContrato)
  tipo_plantilla!: TipoPlantillaContrato;

  @IsInt()
  @IsPositive()
  canon_centavos!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dia_pago!: number;

  @IsString()
  @IsNotEmpty()
  forma_pago!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  deposito_centavos?: number;

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
  @FechaFinPosteriorAFechaInicio()
  fecha_fin!: Date;
}
