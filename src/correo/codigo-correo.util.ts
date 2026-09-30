import { createHash, createHmac, randomInt, timingSafeEqual } from 'crypto';

/** Código de 6 dígitos con `crypto.randomInt` (nunca `Math.random`). */
export function generarCodigoNumerico(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

const PREFIJO_DOMINIO = 'rentcheck/codigo-correo/v1|';

/**
 * HMAC-SHA256 del código. La clave se deriva del secreto JWT con un prefijo de
 * dominio fijo (no se reutiliza el secreto tal cual) y el mensaje incluye el
 * correo y el propósito, así un hash no sirve para otro correo ni propósito.
 */
export function hashCodigoCorreo(
  secreto: string,
  correo: string,
  proposito: string,
  codigo: string,
): string {
  const clave = createHash('sha256')
    .update(`${PREFIJO_DOMINIO}${secreto}`)
    .digest();
  return createHmac('sha256', clave)
    .update(`${correo}|${proposito}|${codigo}`)
    .digest('hex');
}

/** Comparación en tiempo constante de dos hashes hexadecimales. */
export function hashesIguales(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
