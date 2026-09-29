import { TipoPlantillaContrato } from '@prisma/client';
import {
  construirTextoContrato,
  DatosContratoParaTexto,
} from './plantillas-contrato';

function contratoBase(
  overrides: Partial<DatosContratoParaTexto> = {},
): DatosContratoParaTexto {
  return {
    tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
    canon_centavos: 100_000_000,
    deposito_centavos: null,
    dia_pago: 5,
    forma_pago: 'Transferencia',
    datos_recaudo: 'Bancolombia 123',
    datos_fiador_o_poliza: null,
    condicionesParticularesTexto: null,
    fecha_inicio: new Date(Date.UTC(2026, 0, 10)),
    fecha_fin: new Date(Date.UTC(2026, 11, 31)),
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
    const texto = construirTextoContrato(contratoBase());

    expect(texto).not.toMatch(/dep[oó]sito/i);
    expect(texto).toContain('CUARTA — GARANTÍAS. Sin garantías adicionales.');
    expect(texto).toContain('OCTAVA — CAUSALES DE TERMINACIÓN');
    expect(texto).not.toContain('NOVENA');
  });

  it('vivienda: la cláusula de garantías usa fiador, codeudor o póliza si hay', () => {
    const texto = construirTextoContrato(
      contratoBase({ datos_fiador_o_poliza: 'Fiador Juan Pérez, CC 123' }),
    );

    expect(texto).toContain('CUARTA — GARANTÍAS.');
    expect(texto).toContain('Fiador Juan Pérez, CC 123');
    expect(texto).not.toContain('Sin garantías adicionales');
    expect(texto).not.toMatch(/dep[oó]sito/i);
  });

  it('local con depósito: incluye la cláusula de depósito con el monto', () => {
    const texto = construirTextoContrato(
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
      const texto = construirTextoContrato(
        contratoBase({ tipo_plantilla: tipo, deposito_centavos: null }),
      );

      expect(texto).not.toContain('— DEPÓSITO.');
      expect(texto).toContain('CUARTA — DESTINACIÓN Y USO.');
      expect(texto).toContain('SÉPTIMA — CAUSALES DE TERMINACIÓN');
      expect(texto).not.toContain('OCTAVA —');
    }
  });

  it('local con depósito y garantía adicional: la garantía queda como última cláusula', () => {
    const texto = construirTextoContrato(
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
    const texto = construirTextoContrato(contratoBase());
    expect(texto).not.toMatch(/\{\{/);
  });
});
