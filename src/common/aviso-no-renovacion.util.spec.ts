import { resumenAvisoNoRenovacion } from './aviso-no-renovacion.util';

const f = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));

const contrato = { estado: 'ACTIVO' as const, fecha_fin: f(2026, 12, 31) };
const hoy = f(2026, 10, 1);
const aviso = {
  dado_por: 'INQUILINO' as const,
  dado_en: new Date('2026-09-30T15:00:00Z'),
  motivo: 'Me mudo',
  cancelado_en: null,
};

describe('resumenAvisoNoRenovacion', () => {
  it('sin aviso: NINGUNO y se puede dar', () => {
    expect(resumenAvisoNoRenovacion(null, contrato, 'ARRENDADOR', hoy)).toEqual(
      {
        estado: 'NINGUNO',
        dado_por: null,
        dado_en: null,
        motivo: null,
        puede_dar: true,
        puede_cancelar: false,
      },
    );
  });

  it('un aviso cancelado cuenta como NINGUNO y se puede volver a dar', () => {
    const cancelado = { ...aviso, cancelado_en: new Date() };
    expect(
      resumenAvisoNoRenovacion(cancelado, contrato, 'INQUILINO', hoy),
    ).toMatchObject({
      estado: 'NINGUNO',
      dado_por: null,
      puede_dar: true,
      puede_cancelar: false,
    });
  });

  it('aviso vigente: solo quien lo dio puede cancelarlo y nadie puede dar otro', () => {
    expect(resumenAvisoNoRenovacion(aviso, contrato, 'INQUILINO', hoy)).toEqual(
      {
        estado: 'DADO',
        dado_por: 'INQUILINO',
        dado_en: aviso.dado_en,
        motivo: 'Me mudo',
        puede_dar: false,
        puede_cancelar: true,
      },
    );
    expect(
      resumenAvisoNoRenovacion(aviso, contrato, 'ARRENDADOR', hoy),
    ).toMatchObject({
      puede_dar: false,
      puede_cancelar: false,
    });
  });

  it('el último día o con el contrato no activo no se puede dar ni cancelar', () => {
    expect(
      resumenAvisoNoRenovacion(null, contrato, 'ARRENDADOR', f(2026, 12, 31)),
    ).toMatchObject({
      puede_dar: false,
    });
    expect(
      resumenAvisoNoRenovacion(aviso, contrato, 'INQUILINO', f(2026, 12, 31)),
    ).toMatchObject({
      estado: 'DADO',
      puede_cancelar: false,
    });
    expect(
      resumenAvisoNoRenovacion(
        null,
        { ...contrato, estado: 'VENCIDO' },
        'ARRENDADOR',
        hoy,
      ),
    ).toMatchObject({ puede_dar: false });
  });
});
