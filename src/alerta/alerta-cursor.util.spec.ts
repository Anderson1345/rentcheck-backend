import { codificarCursor, decodificarCursor } from './alerta-cursor.util';

const ID = '44444444-4444-4444-8444-444444444444';
// Un instante cualquiera (con milisegundos): solo importa que ida y vuelta lo conserve.
const INSTANTE = new Date('2031-04-01T15:04:05.123Z');

function enBase64(valor: unknown): string {
  return Buffer.from(
    typeof valor === 'string' ? valor : JSON.stringify(valor),
    'utf8',
  ).toString('base64url');
}

describe('cursor de alertas', () => {
  it('ida y vuelta conserva el instante (al milisegundo) y el id', () => {
    const cursor = codificarCursor({ creado_en: INSTANTE, id: ID });
    const decodificado = decodificarCursor(cursor);
    expect(decodificado).not.toBeNull();
    expect(decodificado?.creado_en.getTime()).toBe(INSTANTE.getTime());
    expect(decodificado?.id).toBe(ID);
  });

  it('es opaco: texto base64url sin el id ni la fecha a la vista', () => {
    const cursor = codificarCursor({ creado_en: INSTANTE, id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(ID);
    expect(cursor).not.toContain('2031');
  });

  it.each([
    ['vacío', ''],
    ['no es base64 ni JSON', '%%%no-es-un-cursor%%%'],
    ['base64 de algo que no es JSON', enBase64('hola')],
    ['JSON que no es un objeto', enBase64('[1,2]')],
    ['sin id', enBase64({ creado_en: INSTANTE.toISOString() })],
    ['sin fecha', enBase64({ id: ID })],
    ['fecha inválida', enBase64({ creado_en: 'ayer', id: ID })],
    [
      'fecha que no es texto',
      enBase64({ creado_en: INSTANTE.getTime(), id: ID }),
    ],
    [
      'id que no es un uuid',
      enBase64({ creado_en: INSTANTE.toISOString(), id: 'abc' }),
    ],
    [
      'id que no es texto',
      enBase64({ creado_en: INSTANTE.toISOString(), id: 7 }),
    ],
  ])('inválido (%s) → null', (_nombre, cursor) => {
    expect(decodificarCursor(cursor)).toBeNull();
  });
});
