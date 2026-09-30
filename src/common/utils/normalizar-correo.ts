/**
 * Los correos se guardan y comparan sin espacios sobrantes y en minúsculas
 * (regla 25). Toda escritura o comparación de un correo pasa por aquí.
 */
export function normalizarCorreo(valor: string): string {
  return valor.trim().toLowerCase();
}
