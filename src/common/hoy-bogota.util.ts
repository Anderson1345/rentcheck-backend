const FORMATEADOR_FECHA_BOGOTA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Devuelve el día calendario de "hoy" en la zona horaria America/Bogota,
 * representado como medianoche UTC de ese día (el mismo formato en que
 * Prisma entrega los campos `@db.Date`: fecha_inicio, fecha_fin,
 * fecha_reportada, fecha_aplicacion).
 */
export function hoyEnBogota(ahora: Date = new Date()): Date {
  const partes = FORMATEADOR_FECHA_BOGOTA.formatToParts(ahora);
  const anio = Number(partes.find((parte) => parte.type === 'year')?.value);
  const mes = Number(partes.find((parte) => parte.type === 'month')?.value);
  const dia = Number(partes.find((parte) => parte.type === 'day')?.value);

  return new Date(Date.UTC(anio, mes - 1, dia));
}

const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000;

/**
 * Instante (UTC) en que empieza un día calendario de Bogotá: su medianoche
 * local. Recibe el día como lo devuelve `hoyEnBogota` (medianoche UTC). Bogotá
 * es UTC-5 todo el año (Colombia no tiene horario de verano).
 */
export function inicioDelDiaBogota(dia: Date): Date {
  return new Date(dia.getTime() + OFFSET_BOGOTA_MS);
}
