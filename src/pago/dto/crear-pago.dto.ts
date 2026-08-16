import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { NoEsFechaFutura } from '../../common/validadores-fecha';

export class CrearPagoDto {
  @IsString()
  @IsNotEmpty()
  contratoId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsPositive()
  monto_centavos!: number;

  @Type(() => Date)
  @IsDate()
  @NoEsFechaFutura()
  fecha_reportada!: Date;
}
