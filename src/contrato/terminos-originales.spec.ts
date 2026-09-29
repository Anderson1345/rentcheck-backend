import { terminosOriginales } from './terminos-originales';

const f = (anio: number, mes: number, dia: number) =>
  new Date(Date.UTC(anio, mes - 1, dia));

const contrato = { canon_centavos: 120_000_000, fecha_fin: f(2028, 12, 31) };

describe('terminosOriginales', () => {
  it('sin incrementos ni prórrogas devuelve los términos vigentes', () => {
    expect(terminosOriginales(contrato, [], [])).toEqual({
      canon_centavos: 120_000_000,
      fecha_fin: f(2028, 12, 31),
    });
  });

  it('con incrementos usa el canon anterior del PRIMERO, no del último', () => {
    const resultado = terminosOriginales(
      contrato,
      [
        {
          fecha_aplicacion: f(2028, 1, 15),
          creado_en: new Date('2028-01-15T10:00:00Z'),
          canon_anterior_centavos: 110_000_000,
        },
        {
          fecha_aplicacion: f(2027, 1, 15),
          creado_en: new Date('2027-01-15T10:00:00Z'),
          canon_anterior_centavos: 100_000_000,
        },
      ],
      [],
    );

    expect(resultado.canon_centavos).toBe(100_000_000);
    expect(resultado.fecha_fin).toEqual(f(2028, 12, 31));
  });

  it('con prórrogas usa la fecha de fin anterior de la PRIMERA', () => {
    const resultado = terminosOriginales(
      contrato,
      [],
      [
        {
          fecha_aplicacion: f(2027, 10, 1),
          creado_en: new Date('2027-10-01T10:00:00Z'),
          fecha_fin_anterior: f(2027, 12, 31),
        },
        {
          fecha_aplicacion: f(2026, 10, 1),
          creado_en: new Date('2026-10-01T10:00:00Z'),
          fecha_fin_anterior: f(2026, 12, 31),
        },
      ],
    );

    expect(resultado.fecha_fin).toEqual(f(2026, 12, 31));
    expect(resultado.canon_centavos).toBe(120_000_000);
  });

  it('con la misma fecha de aplicación desempata por creado_en', () => {
    const resultado = terminosOriginales(
      contrato,
      [
        {
          fecha_aplicacion: f(2027, 1, 15),
          creado_en: new Date('2027-01-15T12:00:00Z'),
          canon_anterior_centavos: 105_000_000,
        },
        {
          fecha_aplicacion: f(2027, 1, 15),
          creado_en: new Date('2027-01-15T09:00:00Z'),
          canon_anterior_centavos: 100_000_000,
        },
      ],
      [],
    );

    expect(resultado.canon_centavos).toBe(100_000_000);
  });

  it('no modifica los arreglos recibidos', () => {
    const incrementos = [
      {
        fecha_aplicacion: f(2028, 1, 15),
        creado_en: new Date('2028-01-15T10:00:00Z'),
        canon_anterior_centavos: 110_000_000,
      },
      {
        fecha_aplicacion: f(2027, 1, 15),
        creado_en: new Date('2027-01-15T10:00:00Z'),
        canon_anterior_centavos: 100_000_000,
      },
    ];
    terminosOriginales(contrato, incrementos, []);

    expect(incrementos[0].canon_anterior_centavos).toBe(110_000_000);
  });
});
