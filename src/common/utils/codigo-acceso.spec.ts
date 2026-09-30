import {
  ALFABETO_CODIGO,
  BLOQUEO_MINUTOS,
  DIAS_EXPIRACION_CODIGO,
  FORMATO_CODIGO,
  generarCodigoAcceso,
  MAX_INTENTOS_FALLIDOS,
  normalizarCodigoAcceso,
} from './codigo-acceso';

describe('generarCodigoAcceso', () => {
  it('siempre cumple RC-XXXX-XXXX con el alfabeto sin I, O, 0 ni 1', () => {
    const formato =
      /^RC-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
    for (let i = 0; i < 5000; i += 1) {
      expect(generarCodigoAcceso()).toMatch(formato);
    }
    expect(FORMATO_CODIGO.test(generarCodigoAcceso())).toBe(true);
  });

  it('no usa caracteres confusos y usa todo el alfabeto', () => {
    expect(ALFABETO_CODIGO).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    for (const prohibido of ['I', 'O', '0', '1']) {
      expect(ALFABETO_CODIGO).not.toContain(prohibido);
    }
    const vistos = new Set<string>();
    for (let i = 0; i < 3000; i += 1) {
      for (const caracter of generarCodigoAcceso().replace(/^RC-|-/g, '')) {
        vistos.add(caracter);
      }
    }
    expect(vistos.size).toBe(ALFABETO_CODIGO.length);
  });

  it('genera códigos distintos', () => {
    const codigos = new Set(
      Array.from({ length: 2000 }, () => generarCodigoAcceso()),
    );
    expect(codigos.size).toBeGreaterThan(1990);
  });

  it('constantes de expiración y bloqueo', () => {
    expect(DIAS_EXPIRACION_CODIGO).toBe(7);
    expect(MAX_INTENTOS_FALLIDOS).toBe(5);
    expect(BLOQUEO_MINUTOS).toBe(15);
  });
});

describe('normalizarCodigoAcceso', () => {
  it('quita espacios y pasa a mayúsculas', () => {
    expect(normalizarCodigoAcceso('  rc-abcd-2345 ')).toBe('RC-ABCD-2345');
    expect(normalizarCodigoAcceso('rc - abcd - 2345')).toBe('RC-ABCD-2345');
  });

  it('inserta los guiones si llega RCXXXXXXXX (10 caracteres)', () => {
    expect(normalizarCodigoAcceso('RCABCD2345')).toBe('RC-ABCD-2345');
    expect(normalizarCodigoAcceso(' rcabcd2345')).toBe('RC-ABCD-2345');
    expect(normalizarCodigoAcceso('RC2026AB12')).toBe('RC-2026-AB12');
  });

  it('deja igual lo que ya está normalizado y no inventa nada con otras formas', () => {
    expect(normalizarCodigoAcceso('RC-ABCD-2345')).toBe('RC-ABCD-2345');
    expect(normalizarCodigoAcceso('XYZ')).toBe('XYZ');
    expect(normalizarCodigoAcceso('RC-ABC')).toBe('RC-ABC');
  });
});
