import { EstadoSolicitudMantenimiento } from '@prisma/client';
import { IsIn } from 'class-validator';

export class ActualizarEstadoSolicitudMantenimientoDto {
  @IsIn([
    EstadoSolicitudMantenimiento.EN_PROCESO,
    EstadoSolicitudMantenimiento.RESUELTO,
  ])
  estado!: EstadoSolicitudMantenimiento;
}
