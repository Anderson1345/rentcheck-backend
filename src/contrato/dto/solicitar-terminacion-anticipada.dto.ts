import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SolicitarTerminacionAnticipadaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  motivo!: string;

  /**
   * Fecha efectiva de entrega: entre hoy (Bogotá) y la fecha de fin del
   * contrato, y no anterior a su fecha de inicio.
   */
  @Type(() => Date)
  @IsDate()
  fecha_efectiva!: Date;
}
