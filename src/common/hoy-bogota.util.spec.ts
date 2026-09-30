import { hoyEnBogota, inicioDelDiaBogota } from './hoy-bogota.util';

describe('hoyEnBogota', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('devuelve la fecha como medianoche UTC del día calendario en Bogotá', () => {
    // 2026-09-21T15:00:00Z son las 10:00 a.m. del mismo día 21 en Bogotá (UTC-5).
    const resultado = hoyEnBogota(new Date(Date.UTC(2026, 8, 21, 15, 0, 0)));

    expect(resultado.getTime()).toBe(Date.UTC(2026, 8, 21));
    expect(resultado.getUTCHours()).toBe(0);
    expect(resultado.getUTCMinutes()).toBe(0);
  });

  it('usa el día calendario de Bogotá, no el de UTC, cerca de la medianoche', () => {
    // Las 2:00 a.m. UTC del día 21 son las 9:00 p.m. del día 20 en Bogotá.
    jest
      .useFakeTimers()
      .setSystemTime(new Date(Date.UTC(2026, 8, 21, 2, 0, 0)));

    const resultado = hoyEnBogota();

    expect(resultado.getTime()).toBe(Date.UTC(2026, 8, 20));
  });
});

describe('inicioDelDiaBogota', () => {
  it('es la medianoche de Bogotá (05:00 UTC) del día calendario dado', () => {
    expect(
      inicioDelDiaBogota(new Date('2026-09-30T00:00:00Z')).toISOString(),
    ).toBe('2026-09-30T05:00:00.000Z');
  });

  it('el día de Bogotá de las 22:00 del 30/09 (03:00 UTC del 01/10) empieza el 30/09', () => {
    const hoy = hoyEnBogota(new Date('2026-10-01T03:00:00Z'));
    expect(inicioDelDiaBogota(hoy).toISOString()).toBe(
      '2026-09-30T05:00:00.000Z',
    );
  });
});
