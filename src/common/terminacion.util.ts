import { EstadoContrato, RolSolicitante } from '@prisma/client';
import { hoyEnBogota } from './hoy-bogota.util';

export interface DatosFechaFinContrato {
  estado: EstadoContrato;
  fecha_fin: Date;
  terminacionAnticipadaConfirmadaEn: Date | null;
  terminacion_fecha_efectiva: Date | null;
}

export interface DatosTerminacion extends DatosFechaFinContrato {
  terminacionAnticipadaSolicitada: boolean;
  terminacionAnticipadaSolicitadaPor: RolSolicitante | null;
  terminacionAnticipadaSolicitadaEn: Date | null;
  terminacionAnticipadaMotivo: string | null;
  terminacion_confirmada_por: RolSolicitante | null;
}

/**
 * `fecha_fin` que debe usar `calcularEstadoCuenta`: un contrato terminado
 * anticipadamente no genera períodos después de su fecha efectiva (o, en las
 * terminaciones históricas sin fecha efectiva, después del día calendario de
 * Bogotá en que se confirmó). Nunca supera la `fecha_fin` del contrato.
 * Todo llamador de `calcularEstadoCuenta` debe pasar este valor.
 */
export function fechaFinParaEstadoCuenta(
  contrato: DatosFechaFinContrato,
): Date {
  if (contrato.estado !== EstadoContrato.TERMINADO_ANTICIPADAMENTE) {
    return contrato.fecha_fin;
  }
  const efectiva =
    contrato.terminacion_fecha_efectiva ??
    (contrato.terminacionAnticipadaConfirmadaEn
      ? hoyEnBogota(contrato.terminacionAnticipadaConfirmadaEn)
      : null);
  if (!efectiva) {
    return contrato.fecha_fin;
  }
  return efectiva.getTime() < contrato.fecha_fin.getTime()
    ? efectiva
    : contrato.fecha_fin;
}

export interface ResumenTerminacion {
  estado: 'NINGUNA' | 'SOLICITADA' | 'CONFIRMADA';
  solicitada_por: RolSolicitante | null;
  solicitada_en: Date | null;
  motivo: string | null;
  fecha_efectiva: Date | null;
  confirmada_por: RolSolicitante | null;
  confirmada_en: Date | null;
  puede_confirmar: boolean;
  puede_cancelar: boolean;
}

/** Resumen de la terminación anticipada visto por `rolQueConsulta`. */
export function resumenTerminacion(
  contrato: DatosTerminacion,
  rolQueConsulta: RolSolicitante,
): ResumenTerminacion {
  const confirmada = contrato.terminacionAnticipadaConfirmadaEn !== null;
  const solicitada = contrato.terminacionAnticipadaSolicitada;
  const estado = !solicitada
    ? 'NINGUNA'
    : confirmada
      ? 'CONFIRMADA'
      : 'SOLICITADA';
  const vigente =
    estado === 'SOLICITADA' && contrato.estado === EstadoContrato.ACTIVO;
  const solicitadaPor = contrato.terminacionAnticipadaSolicitadaPor;

  return {
    estado,
    solicitada_por: solicitada ? solicitadaPor : null,
    solicitada_en: solicitada
      ? contrato.terminacionAnticipadaSolicitadaEn
      : null,
    motivo: solicitada ? contrato.terminacionAnticipadaMotivo : null,
    fecha_efectiva: solicitada ? contrato.terminacion_fecha_efectiva : null,
    confirmada_por: confirmada ? contrato.terminacion_confirmada_por : null,
    confirmada_en: contrato.terminacionAnticipadaConfirmadaEn,
    puede_confirmar: vigente && solicitadaPor !== rolQueConsulta,
    puede_cancelar: vigente && solicitadaPor === rolQueConsulta,
  };
}
