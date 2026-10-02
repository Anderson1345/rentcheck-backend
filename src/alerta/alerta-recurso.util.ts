export type TipoRecursoAlerta =
  'PAGO' | 'SOLICITUD_MANTENIMIENTO' | 'PERIODO' | 'CONTRATO';

/** A dónde navega la app al abrir la alerta. Se deriva al responder; no se guarda. */
export type RecursoAlerta =
  | {
      tipo: 'PAGO';
      id: string;
      contrato_id: string | null;
      periodo: string | null;
    }
  | { tipo: 'SOLICITUD_MANTENIMIENTO'; id: string; contrato_id: null }
  | { tipo: 'PERIODO'; id: null; contrato_id: string; periodo: string }
  | { tipo: 'CONTRATO'; id: string; contrato_id: string };

export interface ReferenciasAlerta {
  pago_id: string | null;
  solicitud_mantenimiento_id: string | null;
  contrato_id: string | null;
  periodo: Date | null;
}

const aDia = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/**
 * Recurso de una alerta, con prioridad pago > solicitud de mantenimiento > período > contrato.
 * - La solicitud no guarda contrato (B-74): su `contrato_id` es siempre null.
 * - Un período solo es navegable con su contrato; sin él (o sin período) cae al siguiente caso.
 * - `periodo` sale como `AAAA-MM-DD` (es una fecha de día, sin hora ni zona).
 */
export function derivarRecurso(a: ReferenciasAlerta): RecursoAlerta | null {
  if (a.pago_id) {
    return {
      tipo: 'PAGO',
      id: a.pago_id,
      contrato_id: a.contrato_id,
      periodo: a.periodo ? aDia(a.periodo) : null,
    };
  }
  if (a.solicitud_mantenimiento_id) {
    return {
      tipo: 'SOLICITUD_MANTENIMIENTO',
      id: a.solicitud_mantenimiento_id,
      contrato_id: null,
    };
  }
  if (a.contrato_id && a.periodo) {
    return {
      tipo: 'PERIODO',
      id: null,
      contrato_id: a.contrato_id,
      periodo: aDia(a.periodo),
    };
  }
  if (a.contrato_id) {
    return { tipo: 'CONTRATO', id: a.contrato_id, contrato_id: a.contrato_id };
  }
  return null;
}
