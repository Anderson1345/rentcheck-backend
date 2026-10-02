import type {
  EstadoPeriodo,
  PeriodoEstadoCuenta,
} from '../common/estado-cuenta.util';

/** Bloque `periodo_cuenta` de cada pago: el período que cubre, tal como lo calcula el estado de cuenta. */
export interface PeriodoCuentaPago {
  canon_vigente_centavos: number;
  fecha_limite: Date;
  monto_aprobado_centavos: number;
  estado: EstadoPeriodo;
}

function mismoMesUTC(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

/**
 * El período del pago dentro de los que calculó `calcularEstadoCuenta` (única fuente de la regla;
 * aquí no se recalcula nada). `null` si el cálculo no genera ese período: nunca lanza.
 */
export function periodoCuentaDelPago(
  periodos: PeriodoEstadoCuenta[],
  periodoDelPago: Date,
): PeriodoCuentaPago | null {
  const periodo = periodos.find((p) => mismoMesUTC(p.periodo, periodoDelPago));
  if (!periodo) {
    return null;
  }
  return {
    canon_vigente_centavos: periodo.canon_vigente_centavos,
    fecha_limite: periodo.fecha_limite,
    monto_aprobado_centavos: periodo.monto_aprobado_centavos,
    estado: periodo.estado,
  };
}
