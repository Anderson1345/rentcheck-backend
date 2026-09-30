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
