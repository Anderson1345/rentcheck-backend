const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

function ultimoDiaDelMes(anio: number, mesIndiceCero: number): number {
  return new Date(Date.UTC(anio, mesIndiceCero + 1, 0)).getUTCDate();
}

/**
 * Suma meses de calendario a una fecha (medianoche UTC, formato `@db.Date`).
 * Si el día no existe en el mes destino usa el último día de ese mes
 * (29-feb + 12 meses = 28-feb). Si la fecha de partida es el último día de su
 * mes, el resultado es el último día del mes destino (2027-06-30 + 6 =
 * 2027-12-31).
 */
export function sumarMesesUTC(fecha: Date, meses: number): Date {
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth();
  const dia = fecha.getUTCDate();

  const destino = new Date(Date.UTC(anio, mes + meses, 1));
  const anioDestino = destino.getUTCFullYear();
  const mesDestino = destino.getUTCMonth();
  const ultimoDiaDestino = ultimoDiaDelMes(anioDestino, mesDestino);

  const esUltimoDiaDelOrigen = dia === ultimoDiaDelMes(anio, mes);
  const diaFinal = esUltimoDiaDelOrigen
    ? ultimoDiaDestino
    : Math.min(dia, ultimoDiaDestino);

  return new Date(Date.UTC(anioDestino, mesDestino, diaFinal));
}

/** Suma (o resta, con negativos) días de calendario a una fecha UTC. */
export function sumarDiasUTC(fecha: Date, dias: number): Date {
  return new Date(
    Date.UTC(
      fecha.getUTCFullYear(),
      fecha.getUTCMonth(),
      fecha.getUTCDate() + dias,
    ),
  );
}

/**
 * Meses enteros del término de un contrato, con `fecha_fin` inclusive:
 * 2026-01-01 → 2026-12-31 = 12; 2026-01-10 → 2027-01-09 = 12. Mínimo 1.
 */
export function mesesDeTermino(fechaInicio: Date, fechaFin: Date): number {
  const diaSiguienteAlFin = sumarDiasUTC(fechaFin, 1);
  let meses =
    (diaSiguienteAlFin.getUTCFullYear() - fechaInicio.getUTCFullYear()) * 12 +
    (diaSiguienteAlFin.getUTCMonth() - fechaInicio.getUTCMonth());

  while (
    meses > 1 &&
    sumarMesesUTC(fechaInicio, meses).getTime() > diaSiguienteAlFin.getTime()
  ) {
    meses -= 1;
  }
  return Math.max(1, meses);
}

/** Días completos entre dos fechas UTC (b - a). */
export function diasEntreUTC(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MILISEGUNDOS_POR_DIA);
}
