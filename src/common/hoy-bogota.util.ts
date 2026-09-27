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
