import { extensionDeAdjunto, tipoDeAdjunto } from './adjunto-tipo.util';

describe('tipoDeAdjunto (deriva el tipo de la extensión de la ruta guardada)', () => {
  it.each([
    ['solicitudes-mantenimiento/u1/123-foto.jpg', 'IMAGEN'],
    ['solicitudes-mantenimiento/u1/123-foto.jpeg', 'IMAGEN'],
    ['solicitudes-mantenimiento/u1/123-foto.png', 'IMAGEN'],
    ['solicitudes-mantenimiento/u1/123-video.mp4', 'VIDEO'],
  ])('%s → %s', (ruta, tipo) => {
    expect(tipoDeAdjunto(ruta)).toBe(tipo);
  });

  it('extensiones en mayúsculas o mezcladas', () => {
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-VIDEO.MP4')).toBe(
      'VIDEO',
    );
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-foto.JpG')).toBe(
      'IMAGEN',
    );
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-foto.PNG')).toBe(
      'IMAGEN',
    );
  });

  it('sin extensión: null', () => {
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-foto')).toBeNull();
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-foto.')).toBeNull();
  });

  it('un archivo oculto sin nombre (".mp4") no tiene extensión', () => {
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/.mp4')).toBeNull();
  });

  it('ruta nula, indefinida o vacía: null', () => {
    expect(tipoDeAdjunto(null)).toBeNull();
    expect(tipoDeAdjunto(undefined)).toBeNull();
    expect(tipoDeAdjunto('')).toBeNull();
  });

  it('otras extensiones: null (no se adivina)', () => {
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-clip.mov')).toBeNull();
    expect(
      tipoDeAdjunto('solicitudes-mantenimiento/u1/1-foto.heic'),
    ).toBeNull();
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-acta.pdf')).toBeNull();
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-nota.txt')).toBeNull();
  });

  it('doble extensión: manda la última', () => {
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-a.mp4.png')).toBe(
      'IMAGEN',
    );
    expect(tipoDeAdjunto('solicitudes-mantenimiento/u1/1-a.png.mp4')).toBe(
      'VIDEO',
    );
    expect(
      tipoDeAdjunto('solicitudes-mantenimiento/u1/1-a.mp4.exe'),
    ).toBeNull();
  });

  it('un punto en una carpeta no cuenta como extensión del archivo', () => {
    expect(
      tipoDeAdjunto('solicitudes-mantenimiento/u1.mp4/1-video'),
    ).toBeNull();
  });
});

describe('extensionDeAdjunto (según el mimetype ya validado por contenido)', () => {
  it.each([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['video/mp4', '.mp4'],
  ])('%s → %s', (mimetype, extension) => {
    expect(extensionDeAdjunto(mimetype)).toBe(extension);
  });

  it('un tipo que no es de adjunto: null', () => {
    expect(extensionDeAdjunto('application/pdf')).toBeNull();
    expect(extensionDeAdjunto('video/quicktime')).toBeNull();
    expect(extensionDeAdjunto('text/plain')).toBeNull();
    expect(extensionDeAdjunto('')).toBeNull();
  });

  it('lo que devuelve es lo que tipoDeAdjunto reconoce (ida y vuelta)', () => {
    for (const [mimetype, tipo] of [
      ['image/jpeg', 'IMAGEN'],
      ['image/png', 'IMAGEN'],
      ['video/mp4', 'VIDEO'],
    ] as const) {
      const extension = extensionDeAdjunto(mimetype) ?? '';
      expect(tipoDeAdjunto(`x/1-archivo${extension}`)).toBe(tipo);
    }
  });
});
