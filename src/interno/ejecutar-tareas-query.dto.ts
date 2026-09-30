import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class EjecutarTareasQueryDto {
  /** `?esperar=true`: espera a que terminen las tareas y devuelve el resultado de cada una. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true')
  @IsBoolean()
  esperar?: boolean;
}
