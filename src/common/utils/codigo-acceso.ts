import { randomInt } from 'crypto';

/** Constantes del código de acceso (todo en un solo archivo). */
export const PREFIJO_CODIGO = 'RC';
/** Sin I, O, 0 ni 1 para que no se confundan al dictarlos. */
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LONGITUD_BLOQUE_CODIGO = 4;
export const DIAS_EXPIRACION_CODIGO = 7;
export const MAX_INTENTOS_FALLIDOS = 5;
export const BLOQUEO_MINUTOS = 15;

export const FORMATO_CODIGO =
  /^RC-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

function bloqueAleatorio(): string {
  return Array.from(
    { length: LONGITUD_BLOQUE_CODIGO },
    // crypto.randomInt: nunca Math.random para un código de acceso.
    () => ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)],
  ).join('');
}

/** `RC-XXXX-XXXX` (8 caracteres del alfabeto, sin el año). */
export function generarCodigoAcceso(): string {
  return `${PREFIJO_CODIGO}-${bloqueAleatorio()}-${bloqueAleatorio()}`;
}

/** Cuándo vence un código generado en `desde`. */
export function fechaExpiracionCodigo(desde: Date = new Date()): Date {
  return new Date(
    desde.getTime() + DIAS_EXPIRACION_CODIGO * 24 * 60 * 60 * 1000,
  );
}

/**
 * Normaliza el código que escribe el usuario: sin espacios y en mayúsculas;
 * si llega sin guiones (`RCXXXXXXXX`, 10 caracteres) se los inserta.
 */
export function normalizarCodigoAcceso(entrada: string): string {
  const limpio = entrada.replace(/\s+/g, '').toUpperCase();
  if (/^RC[A-Z0-9]{8}$/.test(limpio)) {
    return `${limpio.slice(0, 2)}-${limpio.slice(2, 6)}-${limpio.slice(6)}`;
  }
  return limpio;
}
