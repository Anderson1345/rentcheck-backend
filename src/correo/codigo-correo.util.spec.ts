import { generarCodigoNumerico, hashCodigoCorreo } from './codigo-correo.util';

describe('codigo-correo.util', () => {
  it('genera siempre 6 dígitos, con ceros a la izquierda', () => {
    const aleatorio = jest.spyOn(Math, 'random');
    for (let i = 0; i < 500; i += 1) {
      expect(generarCodigoNumerico()).toMatch(/^\d{6}$/);
    }
    // Nunca usa Math.random.
    expect(aleatorio).not.toHaveBeenCalled();
    aleatorio.mockRestore();
  });

  it('el hash es un HMAC-SHA256 hexadecimal que depende del secreto, el correo, el propósito y el código', () => {
    const base = hashCodigoCorreo(
      'secreto-jwt',
      'a@b.com',
      'VERIFICACION',
      '123456',
    );
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).toBe(
      hashCodigoCorreo('secreto-jwt', 'a@b.com', 'VERIFICACION', '123456'),
    );
    expect(base).not.toContain('123456');
    for (const otro of [
      hashCodigoCorreo('otro-secreto', 'a@b.com', 'VERIFICACION', '123456'),
      hashCodigoCorreo('secreto-jwt', 'c@b.com', 'VERIFICACION', '123456'),
      hashCodigoCorreo('secreto-jwt', 'a@b.com', 'RECUPERACION', '123456'),
      hashCodigoCorreo('secreto-jwt', 'a@b.com', 'VERIFICACION', '654321'),
    ]) {
      expect(otro).not.toBe(base);
    }
  });
});
