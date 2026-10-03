import { MotivoRechazoPago } from '@prisma/client';

// Textos de las alertas que llevan datos del pago. El resto de las alertas arma su texto en el
// servicio donde ocurre el evento, con `fechaDeAlerta` para cualquier fecha.

/**
 * B-81: la ÚNICA forma de escribir una fecha en el texto de una alerta: `dd/mm/aaaa`, con día y mes de
 * dos dígitos. Recibe una fecha de día (`@db.Date` o `hoyEnBogota`: medianoche UTC del día de Bogotá) y
 * lee sus partes en UTC, así que el día no se corre por la zona horaria.
 */
export function fechaDeAlerta(dia: Date): string {
  const dd = String(dia.getUTCDate()).padStart(2, '0');
  const mm = String(dia.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dia.getUTCFullYear()}`;
}

const MOTIVO_HUMANO: Record<MotivoRechazoPago, string> = {
  [MotivoRechazoPago.MONTO_NO_COINCIDE]: 'el monto no coincide',
  [MotivoRechazoPago.PAGO_NO_VISIBLE]: 'no se ve el pago en el comprobante',
  [MotivoRechazoPago.COMPROBANTE_ILEGIBLE]: 'el comprobante es ilegible',
  [MotivoRechazoPago.OTRO]: 'otro motivo',
};

/** Mes y año del período en español (`abril de 2031`); el período es un día calendario en UTC. */
export function mesDePeriodo(periodo: Date): string {
  return periodo.toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function textoPagoAprobado(periodo: Date): string {
  return `Tu pago de ${mesDePeriodo(periodo)} fue aprobado.`;
}

/**
 * Rechazo del pago: sin motivo, el texto genérico; con motivo, lo dice en lenguaje humano; el mensaje
 * del arrendador (hasta 200 caracteres) se agrega tal cual, sin recortarlo ni escaparlo.
 */
export function textoPagoRechazado(
  periodo: Date,
  motivo: MotivoRechazoPago | null,
  mensaje: string | null,
): string {
  const base = `Tu pago de ${mesDePeriodo(periodo)} fue rechazado`;
  const conMotivo = motivo ? `${base}: ${MOTIVO_HUMANO[motivo]}.` : `${base}.`;
  return mensaje
    ? `${conMotivo} Mensaje del arrendador: ${mensaje}`
    : conMotivo;
}
