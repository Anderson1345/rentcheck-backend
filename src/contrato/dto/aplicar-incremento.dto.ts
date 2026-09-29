import { IsNumber, IsOptional, IsPositive, Max } from 'class-validator';

export class AplicarIncrementoDto {
  /**
   * Porcentaje del incremento (hasta 2 decimales, mayor que 0 y máximo 100).
   * Por defecto se usa el IPC del año calendario anterior. En vivienda no
   * puede superarlo.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100)
  porcentaje?: number;
}
