import {
  EstadoSolicitudMantenimiento,
  UrgenciaMantenimiento,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ListarSolicitudesMantenimientoQueryDto {
  @IsOptional()
  @IsEnum(EstadoSolicitudMantenimiento)
  estado?: EstadoSolicitudMantenimiento;

  @IsOptional()
  @IsEnum(UrgenciaMantenimiento)
  urgencia?: UrgenciaMantenimiento;

  @IsOptional()
  @IsString()
  unidadId?: string;
}
