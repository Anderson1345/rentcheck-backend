import { sumarMesesUTC } from './fechas-contrato.util';

/**
 * Desde cuándo se puede aplicar un incremento de canon: 12 meses después del último incremento o, si
 * no hay ninguno, del inicio del contrato (Ley 820, art. 20). Es la regla de `aplicarIncremento`
 * (409 `INCREMENTO_ANTES_DE_12_MESES`); el Panel del arrendador la reutiliza para listar los
 * incrementos que ya se pueden aplicar.
 */
export function incrementoDisponibleDesde(
  fechaInicio: Date,
  ultimaAplicacion: Date | null,
): Date {
  return sumarMesesUTC(ultimaAplicacion ?? fechaInicio, 12);
}

/**
 * Año del IPC que usa un incremento aplicado hoy: el año calendario anterior (el que falta cuando
 * `aplicarIncremento` responde 409 `IPC_NO_CONFIGURADO`).
 */
export function anioIpcParaIncremento(hoy: Date): number {
  return hoy.getUTCFullYear() - 1;
}
