import {
  TipoPlantillaContrato,
  TipoUnidad,
  UsoPermitido,
} from '@prisma/client';
import {
  plantillaEsperadaParaUnidad,
  plantillaValidaParaUnidad,
} from './plantilla-unidad';

const { VIVIENDA_URBANA_LEY_820, LOCAL_COMERCIAL, PARQUEADERO } =
  TipoPlantillaContrato;

describe('plantillaValidaParaUnidad', () => {
  it('parqueadero: solo la plantilla de parqueadero, sin importar el uso', () => {
    for (const uso of [UsoPermitido.RESIDENCIAL, UsoPermitido.COMERCIAL]) {
      expect(
        plantillaValidaParaUnidad(PARQUEADERO, TipoUnidad.PARQUEADERO, uso),
      ).toBe(true);
      expect(
        plantillaValidaParaUnidad(
          VIVIENDA_URBANA_LEY_820,
          TipoUnidad.PARQUEADERO,
          uso,
        ),
      ).toBe(false);
      expect(
        plantillaValidaParaUnidad(LOCAL_COMERCIAL, TipoUnidad.PARQUEADERO, uso),
      ).toBe(false);
    }
  });

  it('uso residencial: solo vivienda', () => {
    for (const tipo of [
      TipoUnidad.APARTAMENTO,
      TipoUnidad.CASA,
      TipoUnidad.HABITACION,
      TipoUnidad.LOCAL,
    ]) {
      expect(
        plantillaValidaParaUnidad(
          VIVIENDA_URBANA_LEY_820,
          tipo,
          UsoPermitido.RESIDENCIAL,
        ),
      ).toBe(true);
      expect(
        plantillaValidaParaUnidad(
          LOCAL_COMERCIAL,
          tipo,
          UsoPermitido.RESIDENCIAL,
        ),
      ).toBe(false);
      expect(
        plantillaValidaParaUnidad(PARQUEADERO, tipo, UsoPermitido.RESIDENCIAL),
      ).toBe(false);
    }
  });

  it('uso comercial (no parqueadero): solo local comercial', () => {
    for (const tipo of [
      TipoUnidad.LOCAL,
      TipoUnidad.APARTAMENTO,
      TipoUnidad.CASA,
    ]) {
      expect(
        plantillaValidaParaUnidad(
          LOCAL_COMERCIAL,
          tipo,
          UsoPermitido.COMERCIAL,
        ),
      ).toBe(true);
      expect(
        plantillaValidaParaUnidad(
          VIVIENDA_URBANA_LEY_820,
          tipo,
          UsoPermitido.COMERCIAL,
        ),
      ).toBe(false);
      expect(
        plantillaValidaParaUnidad(PARQUEADERO, tipo, UsoPermitido.COMERCIAL),
      ).toBe(false);
    }
  });

  it('plantillaEsperadaParaUnidad devuelve la única plantilla válida', () => {
    expect(
      plantillaEsperadaParaUnidad(
        TipoUnidad.PARQUEADERO,
        UsoPermitido.COMERCIAL,
      ),
    ).toBe(PARQUEADERO);
    expect(
      plantillaEsperadaParaUnidad(
        TipoUnidad.APARTAMENTO,
        UsoPermitido.RESIDENCIAL,
      ),
    ).toBe(VIVIENDA_URBANA_LEY_820);
    expect(
      plantillaEsperadaParaUnidad(TipoUnidad.LOCAL, UsoPermitido.COMERCIAL),
    ).toBe(LOCAL_COMERCIAL);
  });
});
