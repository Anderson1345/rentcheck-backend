export function normalizarCedula(valor: string): string {
  return valor
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
