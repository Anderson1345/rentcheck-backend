export interface RangoContrato {
  inicio: Date;
  fin: Date;
}

export interface ContratoExistenteParaTraslape extends RangoContrato {
  terminacion_fecha_efectiva: Date | null;
  /** La terminación anticipada ya fue confirmada por la contraparte. */
  confirmada: boolean;
}

/**
 * Último día calendario en que un contrato ocupa la unidad: su `fecha_fin`,
 * o la fecha efectiva de la terminación anticipada si ya está confirmada y es
 * anterior.
 */
export function finEfectivoContrato(
  contrato: ContratoExistenteParaTraslape,
): Date {
  if (
    contrato.confirmada &&
    contrato.terminacion_fecha_efectiva !== null &&
    contrato.terminacion_fecha_efectiva.getTime() < contrato.fin.getTime()
  ) {
    return contrato.terminacion_fecha_efectiva;
  }
  return contrato.fin;
}

/**
 * Primer contrato existente cuyo rango de días (inclusivo) se traslapa con el
 * del nuevo, o `null`. El siguiente contrato debe empezar DESPUÉS del último
 * día del anterior: no se puede compartir un día.
 */
export function buscarTraslape<T extends ContratoExistenteParaTraslape>(
  nuevo: RangoContrato,
  existentes: T[],
): T | null {
  return (
    existentes.find(
      (existente) =>
        nuevo.inicio.getTime() <= finEfectivoContrato(existente).getTime() &&
        existente.inicio.getTime() <= nuevo.fin.getTime(),
    ) ?? null
  );
}

export function hayTraslape(
  nuevo: RangoContrato,
  existentes: ContratoExistenteParaTraslape[],
): boolean {
  return buscarTraslape(nuevo, existentes) !== null;
}
