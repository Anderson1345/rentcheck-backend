import { hoyEnBogota } from './hoy-bogota.util';

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
