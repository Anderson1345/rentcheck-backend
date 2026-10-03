import { MotivoRechazoPago } from '@prisma/client';
import {
  fechaDeAlerta,
  mesDePeriodo,
  textoPagoAprobado,
  textoPagoRechazado,
} from './textos-alerta';

// Un mes cualquiera: solo importa el formato (mes en español y año de 4 dígitos).
const PERIODO = new Date('2031-04-01T00:00:00.000Z');

describe('textos de alertas', () => {
  it('mesDePeriodo: mes en minúscula y año, sin que la zona horaria lo corra al mes anterior', () => {
    expect(mesDePeriodo(PERIODO)).toBe('abril de 2031');
    expect(mesDePeriodo(new Date('2031-01-01T00:00:00.000Z'))).toBe(
      'enero de 2031',
    );
    expect(mesDePeriodo(new Date('2031-12-01T00:00:00.000Z'))).toBe(
      'diciembre de 2031',
    );
  });

  it('pago aprobado menciona el mes', () => {
    expect(textoPagoAprobado(PERIODO)).toBe(
      'Tu pago de abril de 2031 fue aprobado.',
    );
  });

  describe('pago rechazado', () => {
    it('sin motivo: texto genérico de rechazo', () => {
      expect(textoPagoRechazado(PERIODO, null, null)).toBe(
        'Tu pago de abril de 2031 fue rechazado.',
      );
    });

    it.each([
      [MotivoRechazoPago.MONTO_NO_COINCIDE, 'el monto no coincide'],
      [MotivoRechazoPago.PAGO_NO_VISIBLE, 'no se ve el pago en el comprobante'],
      [MotivoRechazoPago.COMPROBANTE_ILEGIBLE, 'el comprobante es ilegible'],
      [MotivoRechazoPago.OTRO, 'otro motivo'],
    ])('con el motivo %s lo dice en lenguaje humano', (motivo, humano) => {
      expect(textoPagoRechazado(PERIODO, motivo, null)).toBe(
        `Tu pago de abril de 2031 fue rechazado: ${humano}.`,
      );
    });

    it('con mensaje del arrendador lo agrega tal cual, sin recortar ni escapar', () => {
      const mensaje = 'Sube otra foto, por favor <b>clara</b> & "completa"';
      expect(
        textoPagoRechazado(
          PERIODO,
          MotivoRechazoPago.COMPROBANTE_ILEGIBLE,
          mensaje,
        ),
      ).toBe(
        `Tu pago de abril de 2031 fue rechazado: el comprobante es ilegible. Mensaje del arrendador: ${mensaje}`,
      );
    });

    it('un mensaje de 200 caracteres no se recorta', () => {
      const mensaje = 'x'.repeat(200);
      const texto = textoPagoRechazado(
        PERIODO,
        MotivoRechazoPago.OTRO,
        mensaje,
      );
      expect(texto.endsWith(mensaje)).toBe(true);
    });
  });
});

describe('fechaDeAlerta (B-81): dd/mm/aaaa con ceros', () => {
  it('día y mes de un dígito llevan cero a la izquierda', () => {
    expect(fechaDeAlerta(new Date('2031-04-05T00:00:00.000Z'))).toBe(
      '05/04/2031',
    );
  });

  it('día y mes de dos dígitos quedan igual', () => {
    expect(fechaDeAlerta(new Date('2031-12-31T00:00:00.000Z'))).toBe(
      '31/12/2031',
    );
  });

  it('una fecha de día (medianoche UTC) no se corre al día anterior por la zona de Bogotá', () => {
    expect(fechaDeAlerta(new Date('2031-01-01T00:00:00.000Z'))).toBe(
      '01/01/2031',
    );
  });

  it('nunca produce el formato AAAA-MM-DD', () => {
    expect(fechaDeAlerta(new Date('2031-03-09T00:00:00.000Z'))).not.toMatch(
      /\d{4}-\d{2}-\d{2}/,
    );
  });
});
