import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ProrrogarContratoDto {
  /**
   * Meses de la prórroga (1 a 60). Por defecto, el término inicial del
   * contrato.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  meses?: number;
}
