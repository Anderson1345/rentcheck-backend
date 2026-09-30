import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { FechaFinPosteriorAFechaInicio } from '../../common/validadores-fecha';

/**
 * Corrección de un contrato sin vincular (B-35). Todos los campos son
 * opcionales y siguen las mismas reglas que `CrearContratoDto`. No se pueden
 * cambiar la unidad, el inquilino por id, la plantilla, el estado ni el código.
 */
export class CorregirContratoDto {
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @IsInt()
  @IsPositive()
  canon_centavos?: number;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @IsInt()
  @Min(1)
  @Max(31)
  dia_pago?: number;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @IsString()
  @IsNotEmpty()
  forma_pago?: string;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @IsString()
  @IsNotEmpty()
  datos_recaudo?: string;

  /** Solo Local y Parqueadero; `null` o 0 quitan el depósito. */
  @IsOptional()
  @IsInt()
  @Min(0)
  deposito_centavos?: number | null;

  /** Garantías (fiador, codeudor o póliza); `null` las quita. */
  @IsOptional()
  @IsString()
  datos_fiador_o_poliza?: string | null;

  @IsOptional()
  @IsString()
  condicionesParticularesTexto?: string | null;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Type(() => Date)
  @IsDate()
  fecha_inicio?: Date;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Type(() => Date)
  @IsDate()
  @FechaFinPosteriorAFechaInicio()
  fecha_fin?: Date;
}
