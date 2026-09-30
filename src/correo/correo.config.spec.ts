import { leerConfiguracionCorreo } from './correo.config';

describe('leerConfiguracionCorreo', () => {
  it('sin CORREO_PROVEEDOR el proveedor es desactivado (también en producción)', () => {
    expect(leerConfiguracionCorreo({}).proveedor).toBe('desactivado');
    expect(leerConfiguracionCorreo({ NODE_ENV: 'production' }).proveedor).toBe(
      'desactivado',
    );
    expect(leerConfiguracionCorreo({ CORREO_PROVEEDOR: '   ' }).proveedor).toBe(
      'desactivado',
    );
  });

  it('consola está permitida fuera de producción', () => {
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      expect(
        leerConfiguracionCorreo({ CORREO_PROVEEDOR: 'consola', NODE_ENV })
          .proveedor,
      ).toBe('consola');
    }
  });

  it('consola en producción impide el arranque con un error claro', () => {
    expect(() =>
      leerConfiguracionCorreo({
        CORREO_PROVEEDOR: 'consola',
        NODE_ENV: 'production',
      }),
    ).toThrow(/consola.*producci[oó]n/i);
  });

  it('resend exige RESEND_API_KEY y CORREO_REMITENTE, sin imprimir valores', () => {
    const clave = 're_clave_secreta_de_prueba';
    expect(() =>
      leerConfiguracionCorreo({
        CORREO_PROVEEDOR: 'resend',
        CORREO_REMITENTE: 'RentCheck <no-responder@ejemplo.com>',
      }),
    ).toThrow(/RESEND_API_KEY/);
    expect(() =>
      leerConfiguracionCorreo({
        CORREO_PROVEEDOR: 'resend',
        RESEND_API_KEY: clave,
      }),
    ).toThrow(/CORREO_REMITENTE/);
    try {
      leerConfiguracionCorreo({
        CORREO_PROVEEDOR: 'resend',
        RESEND_API_KEY: clave,
      });
    } catch (error) {
      expect(String(error)).not.toContain(clave);
    }
    expect(
      leerConfiguracionCorreo({
        CORREO_PROVEEDOR: 'resend',
        RESEND_API_KEY: clave,
        CORREO_REMITENTE: 'RentCheck <no-responder@ejemplo.com>',
      }),
    ).toMatchObject({
      proveedor: 'resend',
      resendApiKey: clave,
      remitente: 'RentCheck <no-responder@ejemplo.com>',
    });
  });

  it('un proveedor desconocido impide el arranque', () => {
    expect(() =>
      leerConfiguracionCorreo({ CORREO_PROVEEDOR: 'sendgrid' }),
    ).toThrow(/CORREO_PROVEEDOR/);
  });
});
