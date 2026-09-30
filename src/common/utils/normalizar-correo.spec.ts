import { normalizarCorreo } from './normalizar-correo';

describe('normalizarCorreo', () => {
  it('quita espacios sobrantes y pasa a minúsculas', () => {
    expect(normalizarCorreo('  Ana@Correo.COM ')).toBe('ana@correo.com');
    expect(normalizarCorreo('ana@correo.com')).toBe('ana@correo.com');
    expect(normalizarCorreo('\tAna@Correo.com\n')).toBe('ana@correo.com');
  });
});
