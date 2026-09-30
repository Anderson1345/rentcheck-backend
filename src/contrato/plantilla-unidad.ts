import {
  TipoPlantillaContrato,
  TipoUnidad,
  UsoPermitido,
} from '@prisma/client';

/**
 * Plantilla que corresponde a una unidad: un parqueadero usa la plantilla de
 * parqueadero; en otro caso, el uso residencial usa la de vivienda urbana y
 * el comercial la de local comercial.
 */
export function plantillaEsperadaParaUnidad(
  tipoUnidad: TipoUnidad,
  uso: UsoPermitido,
): TipoPlantillaContrato {
  if (tipoUnidad === TipoUnidad.PARQUEADERO) {
    return TipoPlantillaContrato.PARQUEADERO;
  }
  return uso === UsoPermitido.RESIDENCIAL
    ? TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820
    : TipoPlantillaContrato.LOCAL_COMERCIAL;
}

export function plantillaValidaParaUnidad(
  tipoPlantilla: TipoPlantillaContrato,
  tipoUnidad: TipoUnidad,
  uso: UsoPermitido,
): boolean {
  return tipoPlantilla === plantillaEsperadaParaUnidad(tipoUnidad, uso);
}
