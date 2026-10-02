import {
  anioIpcParaIncremento,
  incrementoDisponibleDesde,
} from './incremento-disponible.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('incrementoDisponibleDesde (regla de 12 meses de aplicarIncremento)', () => {
  it('sin incrementos cuenta desde el inicio del contrato', () => {
    expect(incrementoDisponibleDesde(d('2026-03-10'), null).toISOString()).toBe(
      d('2027-03-10').toISOString(),
    );
  });

  it('con incrementos cuenta desde el último', () => {
    expect(
      incrementoDisponibleDesde(d('2026-03-10'), d('2027-03-10')).toISOString(),
    ).toBe(d('2028-03-10').toISOString());
  });

  it('29 de febrero + 12 meses = 28 de febrero (misma suma de meses del repo)', () => {
    expect(incrementoDisponibleDesde(d('2028-02-29'), null).toISOString()).toBe(
      d('2029-02-28').toISOString(),
    );
  });
});

describe('anioIpcParaIncremento', () => {
  it('es el año calendario anterior al de hoy, también en enero y diciembre', () => {
    expect(anioIpcParaIncremento(d('2026-10-02'))).toBe(2025);
    expect(anioIpcParaIncremento(d('2027-01-01'))).toBe(2026);
    expect(anioIpcParaIncremento(d('2026-12-31'))).toBe(2025);
  });
});
