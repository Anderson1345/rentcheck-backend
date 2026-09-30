import { EstadoContrato, RolSolicitante } from '@prisma/client';
import { hoyEnBogota } from './hoy-bogota.util';

export interface DatosAvisoNoRenovacion {
  dado_por: RolSolicitante;
  dado_en: Date;
  motivo: string | null;
  cancelado_en: Date | null;
}

export interface ResumenAvisoNoRenovacion {
  estado: 'NINGUNO' | 'DADO';
  dado_por: RolSolicitante | null;
  dado_en: Date | null;
  motivo: string | null;
  puede_dar: boolean;
  puede_cancelar: boolean;
}

/**
 * Resumen del aviso de no renovación visto por `rolQueConsulta`. El aviso
 * está vigente mientras `cancelado_en` sea nulo. Solo se puede dar o cancelar
 * con el contrato ACTIVO y antes de su último día (`hoy < fecha_fin`).
 */
export function resumenAvisoNoRenovacion(
  aviso: DatosAvisoNoRenovacion | null,
  contrato: { estado: EstadoContrato; fecha_fin: Date },
  rolQueConsulta: RolSolicitante,
  hoy: Date = hoyEnBogota(),
): ResumenAvisoNoRenovacion {
  const vigente = aviso !== null && aviso.cancelado_en === null;
  const enPlazo =
    contrato.estado === EstadoContrato.ACTIVO &&
    hoy.getTime() < contrato.fecha_fin.getTime();

  return {
    estado: vigente ? 'DADO' : 'NINGUNO',
    dado_por: vigente ? aviso.dado_por : null,
    dado_en: vigente ? aviso.dado_en : null,
    motivo: vigente ? aviso.motivo : null,
    puede_dar: !vigente && enPlazo,
    puede_cancelar: vigente && enPlazo && aviso.dado_por === rolQueConsulta,
  };
}
