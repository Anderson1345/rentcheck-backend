import { TipoPlantillaContrato } from '@prisma/client';
import {
  construirTextoContrato,
  DatosContratoParaTexto,
  TerminosContrato,
} from './plantillas-contrato';

const TERMINOS: TerminosContrato = {
  canon_centavos: 100_000_000,
  fecha_fin: new Date(Date.UTC(2026, 11, 31)),
};

function generar(
  datos: DatosContratoParaTexto,
  terminos: TerminosContrato = TERMINOS,
): string {
  return construirTextoContrato(datos, terminos);
}

function contratoBase(
  overrides: Partial<DatosContratoParaTexto> = {},
): DatosContratoParaTexto {
  return {
    tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
    deposito_centavos: null,
    dia_pago: 5,
    forma_pago: 'Transferencia',
    datos_recaudo: 'Bancolombia 123',
    datos_fiador_o_poliza: null,
    condicionesParticularesTexto: null,
    fecha_inicio: new Date(Date.UTC(2026, 0, 10)),
    arrendador: { nombre: 'Ana Arrendadora', cedula: '900123456' },
    inquilino: { nombre: 'Ivan Inquilino', cedula: '1000111222' },
    unidad: {
      nombre: 'Apto 101',
      inmueble: { direccion: 'Calle 1 # 2-3', ciudad: 'Bogotá' },
    },
    ...overrides,
  };
}

describe('construirTextoContrato', () => {
  it('vivienda: no menciona depósito y trae la cláusula de garantías', () => {
    const texto = generar(contratoBase());

    expect(texto).not.toMatch(/dep[oó]sito/i);
    expect(texto).toContain('CUARTA — GARANTÍAS. Sin garantías adicionales.');
    expect(texto).toContain('OCTAVA — CAUSALES DE TERMINACIÓN');
    expect(texto).not.toContain('NOVENA');
  });

  it('vivienda: la cláusula de garantías usa fiador, codeudor o póliza si hay', () => {
    const texto = generar(
      contratoBase({ datos_fiador_o_poliza: 'Fiador Juan Pérez, CC 123' }),
    );

    expect(texto).toContain('CUARTA — GARANTÍAS.');
    expect(texto).toContain('Fiador Juan Pérez, CC 123');
    expect(texto).not.toContain('Sin garantías adicionales');
    expect(texto).not.toMatch(/dep[oó]sito/i);
  });

  it('local con depósito: incluye la cláusula de depósito con el monto', () => {
    const texto = generar(
      contratoBase({
        tipo_plantilla: TipoPlantillaContrato.LOCAL_COMERCIAL,
        deposito_centavos: 50_000_000,
      }),
    );

    expect(texto).toContain('CUARTA — DEPÓSITO.');
    expect(texto).toContain('$500.000');
    expect(texto).toContain('OCTAVA — CAUSALES DE TERMINACIÓN');
  });

  it('local y parqueadero sin depósito: omiten la cláusula y renumeran', () => {
    for (const tipo of [
      TipoPlantillaContrato.LOCAL_COMERCIAL,
      TipoPlantillaContrato.PARQUEADERO,
    ]) {
      const texto = generar(
        contratoBase({ tipo_plantilla: tipo, deposito_centavos: null }),
      );

      expect(texto).not.toContain('— DEPÓSITO.');
      expect(texto).toContain('CUARTA — DESTINACIÓN Y USO.');
      expect(texto).toContain('SÉPTIMA — CAUSALES DE TERMINACIÓN');
      expect(texto).not.toContain('OCTAVA —');
    }
  });

  it('local con depósito y garantía adicional: la garantía queda como última cláusula', () => {
    const texto = generar(
      contratoBase({
        tipo_plantilla: TipoPlantillaContrato.PARQUEADERO,
        deposito_centavos: 10_000_000,
        datos_fiador_o_poliza: 'Póliza 999',
      }),
    );

    expect(texto).toContain('NOVENA — GARANTÍA ADICIONAL.');
    expect(texto).toContain('Póliza 999');
  });

  it('reemplaza todos los marcadores', () => {
    const texto = generar(contratoBase());
    expect(texto).not.toMatch(/\{\{/);
  });

  it('B-10: la duración sale de las fechas, no es siempre un año', () => {
    const doceMeses = generar(
      contratoBase({ fecha_inicio: new Date(Date.UTC(2026, 0, 1)) }),
    );
    expect(doceMeses).toContain('duración de doce (12) meses');
    expect(doceMeses).not.toContain('un (1) año');

    const seisMeses = generar(
      contratoBase({ fecha_inicio: new Date(Date.UTC(2026, 0, 1)) }),
      { ...TERMINOS, fecha_fin: new Date(Date.UTC(2026, 5, 30)) },
    );
    expect(seisMeses).toContain('duración de seis (6) meses');

    const dieciseis = generar(
      contratoBase({
        tipo_plantilla: TipoPlantillaContrato.LOCAL_COMERCIAL,
        fecha_inicio: new Date(Date.UTC(2026, 0, 1)),
      }),
      { ...TERMINOS, fecha_fin: new Date(Date.UTC(2027, 3, 30)) },
    );
    expect(dieciseis).toContain('duración de dieciséis (16) meses');

    const unMes = generar(
      contratoBase({
        tipo_plantilla: TipoPlantillaContrato.PARQUEADERO,
        fecha_inicio: new Date(Date.UTC(2026, 4, 1)),
      }),
      { ...TERMINOS, fecha_fin: new Date(Date.UTC(2026, 4, 31)) },
    );
    expect(unMes).toContain('duración de un (1) mes,');
  });

  it('B-10: el pago se redacta como "a más tardar el día N de cada mes" en las tres plantillas', () => {
    for (const tipo of [
      TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
      TipoPlantillaContrato.LOCAL_COMERCIAL,
      TipoPlantillaContrato.PARQUEADERO,
    ]) {
      const texto = generar(
        contratoBase({ tipo_plantilla: tipo, dia_pago: 7 }),
      );

      expect(texto).toContain('a más tardar el día 7 de cada mes');
      expect(texto).not.toContain('dentro de los primeros');
    }
  });

  it('el canon y la fecha de fin salen de los términos recibidos', () => {
    const texto = generar(contratoBase(), {
      canon_centavos: 90_000_000,
      fecha_fin: new Date(Date.UTC(2026, 5, 30)),
    });

    expect(texto).toContain('$900.000');
    expect(texto).toContain('hasta el 2026-06-30');
    expect(texto).not.toContain('$1.000.000');
  });
});
