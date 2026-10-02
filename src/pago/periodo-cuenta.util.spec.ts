import type { PeriodoEstadoCuenta } from '../common/estado-cuenta.util';
import { periodoCuentaDelPago } from './periodo-cuenta.util';

const d = (texto: string) => new Date(`${texto}T00:00:00.000Z`);
const periodo = (
  mes: string,
  extra: Partial<PeriodoEstadoCuenta> = {},
): PeriodoEstadoCuenta => ({
  periodo: d(`${mes}-01`),
  fecha_limite: d(`${mes}-05`),
  canon_vigente_centavos: 1_000_000,
  monto_aprobado_centavos: 0,
  estado: 'VENCIDO',
  ...extra,
});

describe('periodoCuentaDelPago', () => {
  const periodos = [
    periodo('2026-08', {
      estado: 'PAGADO',
      monto_aprobado_centavos: 1_000_000,
    }),
    periodo('2026-09', { estado: 'PARCIAL', monto_aprobado_centavos: 400_000 }),
    periodo('2026-10', { estado: 'EN_REVISION' }),
  ];

  it('devuelve el bloque del período del pago (mismo mes calendario)', () => {
    expect(periodoCuentaDelPago(periodos, d('2026-09-01'))).toEqual({
      canon_vigente_centavos: 1_000_000,
      fecha_limite: d('2026-09-05'),
      monto_aprobado_centavos: 400_000,
      estado: 'PARCIAL',
    });
  });

  it('compara por mes, no por el instante exacto', () => {
    expect(periodoCuentaDelPago(periodos, d('2026-10-17'))?.estado).toBe(
      'EN_REVISION',
    );
  });

  it('usa los nombres de la respuesta (canon vigente, fecha límite, aprobado, estado)', () => {
    const bloque = periodoCuentaDelPago(periodos, d('2026-08-01'));
    expect(Object.keys(bloque ?? {}).sort()).toEqual([
      'canon_vigente_centavos',
      'estado',
      'fecha_limite',
      'monto_aprobado_centavos',
    ]);
  });

  it('un período que el cálculo no genera: null (no falla)', () => {
    expect(periodoCuentaDelPago(periodos, d('2020-01-01'))).toBeNull();
    expect(periodoCuentaDelPago([], d('2026-09-01'))).toBeNull();
  });
});
