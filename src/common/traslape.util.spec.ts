import {
  buscarTraslape,
  finEfectivoContrato,
  hayTraslape,
} from './traslape.util';

const f = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));

const existente = {
  inicio: f(2026, 10, 10),
  fin: f(2026, 12, 31),
  terminacion_fecha_efectiva: null,
  confirmada: false,
};

describe('hayTraslape', () => {
  it('sin contratos existentes no hay traslape', () => {
    expect(
      hayTraslape({ inicio: f(2026, 1, 1), fin: f(2026, 12, 31) }, []),
    ).toBe(false);
  });

  it('mismo rango, inicio dentro, fin dentro y contenido: traslape', () => {
    for (const [inicio, fin] of [
      [f(2026, 10, 10), f(2026, 12, 31)],
      [f(2026, 11, 15), f(2027, 3, 1)],
      [f(2026, 9, 1), f(2026, 10, 15)],
      [f(2026, 9, 1), f(2027, 3, 1)],
      [f(2026, 11, 1), f(2026, 11, 5)],
    ]) {
      expect(hayTraslape({ inicio, fin }, [existente])).toBe(true);
    }
  });

  it('los extremos son inclusivos: empezar el último día traslapa; el día siguiente no', () => {
    expect(
      hayTraslape({ inicio: f(2026, 12, 31), fin: f(2027, 6, 30) }, [
        existente,
      ]),
    ).toBe(true);
    expect(
      hayTraslape({ inicio: f(2027, 1, 1), fin: f(2027, 6, 30) }, [existente]),
    ).toBe(false);
    expect(
      hayTraslape({ inicio: f(2026, 5, 1), fin: f(2026, 10, 10) }, [existente]),
    ).toBe(true);
    expect(
      hayTraslape({ inicio: f(2026, 5, 1), fin: f(2026, 10, 9) }, [existente]),
    ).toBe(false);
  });

  it('terminación confirmada: el fin efectivo es la fecha efectiva (si es anterior al fin)', () => {
    const terminado = {
      ...existente,
      terminacion_fecha_efectiva: f(2026, 11, 20),
      confirmada: true,
    };
    expect(finEfectivoContrato(terminado)).toEqual(f(2026, 11, 20));
    expect(
      hayTraslape({ inicio: f(2026, 11, 20), fin: f(2027, 3, 1) }, [terminado]),
    ).toBe(true);
    expect(
      hayTraslape({ inicio: f(2026, 11, 21), fin: f(2027, 3, 1) }, [terminado]),
    ).toBe(false);
  });

  it('terminación solo solicitada, o efectiva posterior al fin: cuenta la fecha_fin', () => {
    const solicitada = {
      ...existente,
      terminacion_fecha_efectiva: f(2026, 11, 20),
      confirmada: false,
    };
    expect(finEfectivoContrato(solicitada)).toEqual(f(2026, 12, 31));
    const posterior = {
      ...existente,
      terminacion_fecha_efectiva: f(2027, 5, 1),
      confirmada: true,
    };
    expect(finEfectivoContrato(posterior)).toEqual(f(2026, 12, 31));
  });

  it('buscarTraslape devuelve el primer contrato en conflicto', () => {
    const otro = { ...existente, inicio: f(2028, 1, 1), fin: f(2028, 12, 31) };
    expect(
      buscarTraslape({ inicio: f(2028, 6, 1), fin: f(2028, 7, 1) }, [
        existente,
        otro,
      ]),
    ).toBe(otro);
    expect(
      buscarTraslape({ inicio: f(2027, 6, 1), fin: f(2027, 7, 1) }, [
        existente,
        otro,
      ]),
    ).toBeNull();
  });
});
