import {
  diasEntreUTC,
  mesesDeTermino,
  sumarDiasUTC,
  sumarMesesUTC,
} from './fechas-contrato.util';

const f = (anio: number, mes: number, dia: number) =>
  new Date(Date.UTC(anio, mes - 1, dia));

describe('sumarMesesUTC', () => {
  it('suma meses de calendario simples', () => {
    expect(sumarMesesUTC(f(2026, 1, 10), 1)).toEqual(f(2026, 2, 10));
    expect(sumarMesesUTC(f(2026, 1, 10), 12)).toEqual(f(2027, 1, 10));
    expect(sumarMesesUTC(f(2026, 3, 5), 0)).toEqual(f(2026, 3, 5));
  });

  it('29 de febrero: usa el último día del mes destino', () => {
    expect(sumarMesesUTC(f(2028, 2, 29), 12)).toEqual(f(2029, 2, 28));
    expect(sumarMesesUTC(f(2024, 2, 29), 12)).toEqual(f(2025, 2, 28));
    expect(sumarMesesUTC(f(2028, 2, 29), 48)).toEqual(f(2032, 2, 29));
  });

  it('día que no existe en el mes destino: recorta al último día', () => {
    expect(sumarMesesUTC(f(2026, 1, 30), 1)).toEqual(f(2026, 2, 28));
    expect(sumarMesesUTC(f(2026, 3, 31), 1)).toEqual(f(2026, 4, 30));
  });

  it('fin de mes: el resultado es el último día del mes destino', () => {
    expect(sumarMesesUTC(f(2026, 12, 31), 12)).toEqual(f(2027, 12, 31));
    expect(sumarMesesUTC(f(2027, 6, 30), 6)).toEqual(f(2027, 12, 31));
    expect(sumarMesesUTC(f(2026, 4, 30), 1)).toEqual(f(2026, 5, 31));
    expect(sumarMesesUTC(f(2026, 2, 28), 1)).toEqual(f(2026, 3, 31));
  });

  it('cambio de año', () => {
    expect(sumarMesesUTC(f(2026, 11, 15), 3)).toEqual(f(2027, 2, 15));
    expect(sumarMesesUTC(f(2026, 12, 31), 1)).toEqual(f(2027, 1, 31));
    expect(sumarMesesUTC(f(2026, 10, 20), 27)).toEqual(f(2029, 1, 20));
  });

  it('devuelve medianoche UTC', () => {
    const resultado = sumarMesesUTC(f(2026, 5, 20), 7);
    expect(resultado.getUTCHours()).toBe(0);
    expect(resultado.getUTCMinutes()).toBe(0);
  });
});

describe('sumarDiasUTC y diasEntreUTC', () => {
  it('suma y resta días cruzando mes y año', () => {
    expect(sumarDiasUTC(f(2026, 12, 31), 1)).toEqual(f(2027, 1, 1));
    expect(sumarDiasUTC(f(2026, 3, 1), -1)).toEqual(f(2026, 2, 28));
    expect(sumarDiasUTC(f(2026, 11, 15), -90)).toEqual(f(2026, 8, 17));
  });

  it('cuenta días entre fechas', () => {
    expect(diasEntreUTC(f(2026, 8, 17), f(2026, 11, 15))).toBe(90);
    expect(diasEntreUTC(f(2026, 1, 1), f(2026, 1, 1))).toBe(0);
  });
});

describe('mesesDeTermino', () => {
  it('término de 12 meses con fecha_fin inclusive', () => {
    expect(mesesDeTermino(f(2026, 1, 1), f(2026, 12, 31))).toBe(12);
    expect(mesesDeTermino(f(2026, 1, 10), f(2027, 1, 9))).toBe(12);
  });

  it('términos de 6 y 16 meses', () => {
    expect(mesesDeTermino(f(2026, 1, 1), f(2026, 6, 30))).toBe(6);
    expect(mesesDeTermino(f(2026, 3, 15), f(2026, 9, 14))).toBe(6);
    expect(mesesDeTermino(f(2026, 1, 1), f(2027, 4, 30))).toBe(16);
    expect(mesesDeTermino(f(2026, 10, 5), f(2028, 2, 4))).toBe(16);
  });

  it('cruza el 29 de febrero y el fin de mes', () => {
    expect(mesesDeTermino(f(2027, 3, 1), f(2028, 2, 29))).toBe(12);
    expect(mesesDeTermino(f(2027, 8, 31), f(2028, 8, 30))).toBe(12);
  });

  it('mínimo 1 mes', () => {
    expect(mesesDeTermino(f(2026, 5, 1), f(2026, 5, 10))).toBe(1);
    expect(mesesDeTermino(f(2026, 5, 1), f(2026, 5, 1))).toBe(1);
  });
});
