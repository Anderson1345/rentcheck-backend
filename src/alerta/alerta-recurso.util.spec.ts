import { derivarRecurso } from './alerta-recurso.util';

const PAGO = '11111111-1111-4111-8111-111111111111';
const SOLICITUD = '22222222-2222-4222-8222-222222222222';
const CONTRATO = '33333333-3333-4333-8333-333333333333';
// Un valor de calendario cualquiera: solo se comprueba que sale como AAAA-MM-DD.
const PERIODO = new Date('2031-04-01T00:00:00.000Z');

const sinNada = {
  pago_id: null,
  solicitud_mantenimiento_id: null,
  contrato_id: null,
  periodo: null,
};

describe('derivarRecurso', () => {
  it('sin ninguna referencia no hay recurso', () => {
    expect(derivarRecurso(sinNada)).toBeNull();
  });

  it('un período sin contrato no es navegable: sin recurso', () => {
    expect(derivarRecurso({ ...sinNada, periodo: PERIODO })).toBeNull();
  });

  it('solo contrato: CONTRATO con su id', () => {
    expect(derivarRecurso({ ...sinNada, contrato_id: CONTRATO })).toEqual({
      tipo: 'CONTRATO',
      id: CONTRATO,
      contrato_id: CONTRATO,
    });
  });

  it('contrato y período: PERIODO sin id propio, con AAAA-MM-DD', () => {
    expect(
      derivarRecurso({ ...sinNada, contrato_id: CONTRATO, periodo: PERIODO }),
    ).toEqual({
      tipo: 'PERIODO',
      id: null,
      contrato_id: CONTRATO,
      periodo: '2031-04-01',
    });
  });

  it('solicitud de mantenimiento: contrato_id siempre null (la solicitud no guarda contrato, B-74)', () => {
    expect(
      derivarRecurso({
        ...sinNada,
        solicitud_mantenimiento_id: SOLICITUD,
        contrato_id: CONTRATO,
      }),
    ).toEqual({
      tipo: 'SOLICITUD_MANTENIMIENTO',
      id: SOLICITUD,
      contrato_id: null,
    });
  });

  it('pago: lleva el contrato y el período (null si no se guardó)', () => {
    expect(
      derivarRecurso({
        ...sinNada,
        pago_id: PAGO,
        contrato_id: CONTRATO,
        periodo: PERIODO,
      }),
    ).toEqual({
      tipo: 'PAGO',
      id: PAGO,
      contrato_id: CONTRATO,
      periodo: '2031-04-01',
    });
    expect(derivarRecurso({ ...sinNada, pago_id: PAGO })).toEqual({
      tipo: 'PAGO',
      id: PAGO,
      contrato_id: null,
      periodo: null,
    });
  });

  describe('prioridad: pago > solicitud > período > contrato', () => {
    it('pago gana a todo lo demás', () => {
      const recurso = derivarRecurso({
        pago_id: PAGO,
        solicitud_mantenimiento_id: SOLICITUD,
        contrato_id: CONTRATO,
        periodo: PERIODO,
      });
      expect(recurso?.tipo).toBe('PAGO');
    });

    it('solicitud gana a período y contrato', () => {
      const recurso = derivarRecurso({
        ...sinNada,
        solicitud_mantenimiento_id: SOLICITUD,
        contrato_id: CONTRATO,
        periodo: PERIODO,
      });
      expect(recurso?.tipo).toBe('SOLICITUD_MANTENIMIENTO');
    });

    it('período gana a contrato', () => {
      const recurso = derivarRecurso({
        ...sinNada,
        contrato_id: CONTRATO,
        periodo: PERIODO,
      });
      expect(recurso?.tipo).toBe('PERIODO');
    });
  });
});
