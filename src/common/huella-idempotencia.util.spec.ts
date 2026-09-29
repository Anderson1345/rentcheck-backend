import {
  calcularHuellaPago,
  calcularHuellaSolicitud,
  DatosHuellaPago,
  DatosHuellaSolicitud,
} from './huella-idempotencia.util';

describe('calcularHuellaPago', () => {
  const base: DatosHuellaPago = {
    contratoId: 'c1',
    monto_centavos: 1_000_000,
    fecha_reportada: new Date(Date.UTC(2026, 8, 27)),
    periodo: null,
    comprobante: Buffer.from('comprobante'),
  };

  it('es un SHA-256 hexadecimal y determinista', () => {
    const huella = calcularHuellaPago(base);
    expect(huella).toMatch(/^[0-9a-f]{64}$/);
    expect(calcularHuellaPago({ ...base })).toBe(huella);
  });

  it('trata periodo ausente y null igual', () => {
    const sinPeriodo: DatosHuellaPago = {
      contratoId: base.contratoId,
      monto_centavos: base.monto_centavos,
      fecha_reportada: base.fecha_reportada,
      comprobante: base.comprobante,
    };
    expect(calcularHuellaPago(sinPeriodo)).toBe(calcularHuellaPago(base));
  });

  it('cambia si cambia cualquier campo', () => {
    const huella = calcularHuellaPago(base);
    expect(calcularHuellaPago({ ...base, contratoId: 'c2' })).not.toBe(huella);
    expect(calcularHuellaPago({ ...base, monto_centavos: 1 })).not.toBe(huella);
    expect(
      calcularHuellaPago({
        ...base,
        fecha_reportada: new Date(Date.UTC(2026, 8, 28)),
      }),
    ).not.toBe(huella);
    expect(
      calcularHuellaPago({ ...base, periodo: new Date(Date.UTC(2026, 9, 1)) }),
    ).not.toBe(huella);
    expect(
      calcularHuellaPago({ ...base, comprobante: Buffer.from('otro') }),
    ).not.toBe(huella);
  });

  it('usa solo el día calendario de las fechas, no la hora', () => {
    const conHora = {
      ...base,
      fecha_reportada: new Date(Date.UTC(2026, 8, 27, 15, 30)),
    };
    expect(calcularHuellaPago(conHora)).toBe(calcularHuellaPago(base));
  });
});

describe('calcularHuellaSolicitud', () => {
  const base: DatosHuellaSolicitud = {
    unidadId: 'u1',
    descripcion: 'Fuga de agua',
    urgencia: 'ALTO',
    adjunto: null,
  };

  it('es determinista y trata adjunto ausente y null igual', () => {
    const huella = calcularHuellaSolicitud(base);
    expect(huella).toMatch(/^[0-9a-f]{64}$/);
    const sinAdjunto: DatosHuellaSolicitud = {
      unidadId: base.unidadId,
      descripcion: base.descripcion,
      urgencia: base.urgencia,
    };
    expect(calcularHuellaSolicitud(sinAdjunto)).toBe(huella);
  });

  it('cambia si cambia cualquier campo o el contenido del adjunto', () => {
    const huella = calcularHuellaSolicitud(base);
    expect(calcularHuellaSolicitud({ ...base, unidadId: 'u2' })).not.toBe(
      huella,
    );
    expect(calcularHuellaSolicitud({ ...base, descripcion: 'x' })).not.toBe(
      huella,
    );
    expect(calcularHuellaSolicitud({ ...base, urgencia: 'BAJO' })).not.toBe(
      huella,
    );
    const conAdjunto = { ...base, adjunto: Buffer.from('a') };
    expect(calcularHuellaSolicitud(conAdjunto)).not.toBe(huella);
    expect(
      calcularHuellaSolicitud({ ...base, adjunto: Buffer.from('b') }),
    ).not.toBe(calcularHuellaSolicitud(conAdjunto));
  });
});
