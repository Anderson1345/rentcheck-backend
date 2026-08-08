import { Type } from 'class-transformer';
import { IsDate, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CrearPagoDto {
  @IsString()
  @IsNotEmpty()
  contratoId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  monto_centavos!: number;

  @Type(() => Date)
  @IsDate()
  fecha_reportada!: Date;
}
