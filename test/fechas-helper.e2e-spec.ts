import { diasEntreUTC } from '../src/common/fechas-contrato.util';
import {
  enDias,
  fechasDeContratoPorDefecto,
  hoyDePrueba,
} from './helpers/fechas.helper';

/** Solo se simula `Date`; los temporizadores siguen reales. */
const SOLO_DATE = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

describe('helper de fechas de las pruebas', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('las fechas por defecto son un contrato vigente de 365 días: inicio < hoy < fin', () => {
    const { fecha_inicio, fecha_fin } = fechasDeContratoPorDefecto();
    const hoy = hoyDePrueba();
    const inicio = new Date(`${fecha_inicio}T00:00:00Z`);
    const fin = new Date(`${fecha_fin}T00:00:00Z`);

    expect(inicio.getTime()).toBeLessThan(hoy.getTime());
    expect(fin.getTime()).toBeGreaterThan(hoy.getTime());
    expect(diasEntreUTC(inicio, fin)).toBe(365);
  });

  it.each([
    '2027-03-15T15:00:00.000Z',
    '2028-01-01T03:00:00.000Z',
    '2031-07-20T12:00:00.000Z',
  ])(
    'con el reloj simulado en %s las fechas siguen siendo las de un contrato vigente (no dependen del año)',
    (ahora) => {
      jest.useFakeTimers({ now: new Date(ahora), doNotFake: [...SOLO_DATE] });

      const { fecha_inicio, fecha_fin } = fechasDeContratoPorDefecto();
      const hoy = hoyDePrueba();
      const inicio = new Date(`${fecha_inicio}T00:00:00Z`);
      const fin = new Date(`${fecha_fin}T00:00:00Z`);

      expect(inicio.getTime()).toBeLessThan(hoy.getTime());
      expect(fin.getTime()).toBeGreaterThan(hoy.getTime());
      expect(diasEntreUTC(hoy, fin)).toBe(335);
      expect(Number(fecha_fin.slice(0, 4))).toBeGreaterThanOrEqual(2027);
    },
  );

  it('enDias usa el día de Bogotá: a las 22:00 del 30/09 (03:00 UTC del 01/10) hoy es el 30/09', () => {
    jest.useFakeTimers({
      now: new Date('2026-10-01T03:00:00.000Z'),
      doNotFake: [...SOLO_DATE],
    });

    expect(enDias(0)).toBe('2026-09-30');
    expect(enDias(1)).toBe('2026-10-01');
    expect(enDias(-30)).toBe('2026-08-31');
  });
});
