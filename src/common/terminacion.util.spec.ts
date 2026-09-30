import {
  fechaFinParaEstadoCuenta,
  resumenTerminacion,
} from './terminacion.util';

const f = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));

const base = {
  estado: 'ACTIVO' as const,
  fecha_fin: f(2027, 1, 31),
  terminacionAnticipadaSolicitada: false,
  terminacionAnticipadaSolicitadaPor: null,
  terminacionAnticipadaSolicitadaEn: null,
  terminacionAnticipadaMotivo: null,
  terminacionAnticipadaConfirmadaEn: null,
  terminacion_fecha_efectiva: null,
  terminacion_confirmada_por: null,
};

describe('fechaFinParaEstadoCuenta', () => {
  it('contrato no terminado: su fecha_fin', () => {
    expect(fechaFinParaEstadoCuenta(base)).toEqual(f(2027, 1, 31));
    expect(
      fechaFinParaEstadoCuenta({
        ...base,
        estado: 'VENCIDO',
        terminacion_fecha_efectiva: f(2026, 5, 1),
      }),
    ).toEqual(f(2027, 1, 31));
  });

  it('terminado con fecha efectiva: el mínimo con fecha_fin', () => {
    const terminado = { ...base, estado: 'TERMINADO_ANTICIPADAMENTE' as const };
    expect(
      fechaFinParaEstadoCuenta({
        ...terminado,
        terminacion_fecha_efectiva: f(2026, 8, 15),
      }),
    ).toEqual(f(2026, 8, 15));
    expect(
      fechaFinParaEstadoCuenta({
        ...terminado,
        terminacion_fecha_efectiva: f(2028, 1, 1),
      }),
    ).toEqual(f(2027, 1, 31));
  });

  it('terminado histórico sin fecha efectiva: día calendario de Bogotá de la confirmación', () => {
    const terminado = { ...base, estado: 'TERMINADO_ANTICIPADAMENTE' as const };
    // 2026-08-16 02:30 UTC = 2026-08-15 21:30 en Bogotá.
    expect(
      fechaFinParaEstadoCuenta({
        ...terminado,
        terminacionAnticipadaConfirmadaEn: new Date('2026-08-16T02:30:00Z'),
      }),
    ).toEqual(f(2026, 8, 15));
  });

  it('terminado sin ninguna fecha: su fecha_fin', () => {
    expect(
      fechaFinParaEstadoCuenta({
        ...base,
        estado: 'TERMINADO_ANTICIPADAMENTE',
      }),
    ).toEqual(f(2027, 1, 31));
  });
});

describe('resumenTerminacion', () => {
  it('sin solicitud: NINGUNA y sin acciones', () => {
    expect(resumenTerminacion(base, 'ARRENDADOR')).toMatchObject({
      estado: 'NINGUNA',
      solicitada_por: null,
      puede_confirmar: false,
      puede_cancelar: false,
    });
  });

  it('solicitada: la contraparte puede confirmar y el solicitante cancelar', () => {
    const solicitada = {
      ...base,
      terminacionAnticipadaSolicitada: true,
      terminacionAnticipadaSolicitadaPor: 'INQUILINO' as const,
      terminacionAnticipadaSolicitadaEn: new Date('2026-09-01T10:00:00Z'),
      terminacionAnticipadaMotivo: 'Me mudo',
      terminacion_fecha_efectiva: f(2026, 10, 1),
    };
    expect(resumenTerminacion(solicitada, 'ARRENDADOR')).toEqual({
      estado: 'SOLICITADA',
      solicitada_por: 'INQUILINO',
      solicitada_en: new Date('2026-09-01T10:00:00Z'),
      motivo: 'Me mudo',
      fecha_efectiva: f(2026, 10, 1),
      confirmada_por: null,
      confirmada_en: null,
      puede_confirmar: true,
      puede_cancelar: false,
    });
    expect(resumenTerminacion(solicitada, 'INQUILINO')).toMatchObject({
      puede_confirmar: false,
      puede_cancelar: true,
    });
  });

  it('confirmada: ninguna acción; contrato no activo: ninguna acción', () => {
    const confirmada = {
      ...base,
      terminacionAnticipadaSolicitada: true,
      terminacionAnticipadaSolicitadaPor: 'ARRENDADOR' as const,
      terminacionAnticipadaConfirmadaEn: new Date('2026-09-02T10:00:00Z'),
      terminacion_confirmada_por: 'INQUILINO' as const,
    };
    expect(resumenTerminacion(confirmada, 'INQUILINO')).toMatchObject({
      estado: 'CONFIRMADA',
      confirmada_por: 'INQUILINO',
      puede_confirmar: false,
      puede_cancelar: false,
    });
    expect(
      resumenTerminacion(
        {
          ...base,
          estado: 'VENCIDO',
          terminacionAnticipadaSolicitada: true,
          terminacionAnticipadaSolicitadaPor: 'INQUILINO',
        },
        'ARRENDADOR',
      ),
    ).toMatchObject({ puede_confirmar: false, puede_cancelar: false });
  });
});
