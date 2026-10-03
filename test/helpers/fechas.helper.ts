import { sumarDiasUTC } from '../../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../../src/common/hoy-bogota.util';

/**
 * Fechas de las pruebas: SIEMPRE relativas a hoy en Bogotá, nunca fijas (una
 * fecha fija se vuelve pasada con el tiempo y rompe la regla de `fecha_fin`
 * futura, B-55).
 */

export function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Día calendario de hoy en Bogotá (medianoche UTC). */
export function hoyDePrueba(): Date {
  return hoyEnBogota();
}

/** `AAAA-MM-DD` de hoy (Bogotá) más `dias` (negativos = pasado). */
export function enDias(dias: number): string {
  return fechaISO(sumarDiasUTC(hoyEnBogota(), dias));
}

/** Duración del contrato por defecto de los helpers: 365 días, ya en curso. */
export const DIAS_DE_INICIO_POR_DEFECTO = -30;
export const DIAS_DE_FIN_POR_DEFECTO = 335;

/** Inicio hace 30 días y fin dentro de 335: vigente, de 365 días de duración. */
export function fechasDeContratoPorDefecto(): {
  fecha_inicio: string;
  fecha_fin: string;
} {
  return {
    fecha_inicio: enDias(DIAS_DE_INICIO_POR_DEFECTO),
    fecha_fin: enDias(DIAS_DE_FIN_POR_DEFECTO),
  };
}

/**
 * B-81: las fechas de un texto de alerta que NO están en dd/mm/aaaa con ceros (`AAAA-MM-DD`, o `5/3/2031`
 * con día o mes de un dígito). Vacío si el texto está bien.
 */
export function fechasMalFormadas(texto: string): string[] {
  const iso = texto.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const conBarras = (texto.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) ?? []).filter(
    (fecha) => !/^\d{2}\/\d{2}\/\d{4}$/.test(fecha),
  );
  return [...iso, ...conBarras];
}

/** `AAAA-MM-DD` (o una fecha de día) en el formato de los textos de alerta: dd/mm/aaaa. */
export function fechaDeTexto(fecha: string | Date): string {
  const [anio, mes, dia] = (typeof fecha === 'string' ? fecha : fechaISO(fecha))
    .slice(0, 10)
    .split('-');
  return `${dia}/${mes}/${anio}`;
}
