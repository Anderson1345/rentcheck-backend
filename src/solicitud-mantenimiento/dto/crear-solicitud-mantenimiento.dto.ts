import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { UrgenciaMantenimiento } from '@prisma/client';

export class CrearSolicitudMantenimientoDto {
  @IsString()
  @IsNotEmpty()
  unidadId!: string;

  @IsString()
  @IsNotEmpty()
  descripcion!: string;

  @IsEnum(UrgenciaMantenimiento)
  urgencia!: UrgenciaMantenimiento;
}
