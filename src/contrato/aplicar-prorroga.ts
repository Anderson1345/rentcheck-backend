import { EstadoContrato, Prisma, TipoProrroga } from '@prisma/client';
import { mesesDeTermino, sumarMesesUTC } from '../common/fechas-contrato.util';
import { recalcularEstadoPagoContrato } from '../common/recalcular-estado-pago';

/**
 * Meses del término INICIAL del contrato: se toman de la fecha de fin
 * original (la `fecha_fin_anterior` de la primera prórroga o, si nunca se
 * prorrogó, la fecha de fin actual), no de la ya prorrogada.
 */
export function mesesDelTerminoInicial(
  fechaInicio: Date,
  fechaFinActual: Date,
  primeraFechaFinAnterior: Date | null,
): number {
  return mesesDeTermino(fechaInicio, primeraFechaFinAnterior ?? fechaFinActual);
}

/**
 * Parte común de toda prórroga (manual o automática): escritura condicional a
 * la `fecha_fin` leída, fila `Prorroga` del tipo dado y recálculo de
 * `estado_pago`, dentro de la transacción recibida. Devuelve `null` si otra
 * petición ya cambió la fecha de fin (carrera perdida). El otrosí se genera
 * FUERA de la transacción (`DocumentoContratoService.generarSinPropagarErrores`).
 */
export async function aplicarProrroga(
  tx: Prisma.TransactionClient,
  contratoId: string,
  opciones: {
    fechaFinActual: Date;
    meses: number;
    tipo: TipoProrroga;
    fechaAplicacion: Date;
    /** Día para el recálculo de estado_pago (hoy en Bogotá). */
    hoy: Date;
  },
) {
  const fechaFinNueva = sumarMesesUTC(opciones.fechaFinActual, opciones.meses);

  const resultado = await tx.contrato.updateMany({
    where: {
      id: contratoId,
      estado: EstadoContrato.ACTIVO,
      fecha_fin: opciones.fechaFinActual,
    },
    data: { fecha_fin: fechaFinNueva },
  });
  if (resultado.count === 0) {
    return null;
  }

  const prorroga = await tx.prorroga.create({
    data: {
      contrato_id: contratoId,
      fecha_aplicacion: opciones.fechaAplicacion,
      fecha_fin_anterior: opciones.fechaFinActual,
      fecha_fin_nueva: fechaFinNueva,
      meses: opciones.meses,
      tipo: opciones.tipo,
    },
  });

  await recalcularEstadoPagoContrato(tx, contratoId, opciones.hoy);
  return prorroga;
}
