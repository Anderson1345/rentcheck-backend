/**
 * Canon nuevo tras un incremento, solo con enteros (sin flotantes):
 * porcentaje en puntos base (`round(p * 100)`) y
 * `canon + floor((canon * puntosBase + 5000) / 10000)`, es decir, redondeo
 * "half up" al centavo. Usa BigInt para que canones grandes no pierdan
 * precisión.
 */
export function calcularCanonNuevo(
  canonCentavos: number,
  porcentaje: number,
): number {
  const puntosBase = BigInt(Math.round(porcentaje * 100));
  const canon = BigInt(canonCentavos);
  return Number(canon + (canon * puntosBase + 5000n) / 10000n);
}
