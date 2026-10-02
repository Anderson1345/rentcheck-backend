import {
  extensionDeComprobante,
  tipoDeComprobante,
} from './comprobante-tipo.util';

describe('tipoDeComprobante (deriva el tipo de la extensión de la ruta guardada)', () => {
  it.each([
    ['pagos/c1/123-recibo.pdf', 'PDF'],
    ['pagos/c1/123-recibo.jpg', 'IMAGEN'],
    ['pagos/c1/123-recibo.jpeg', 'IMAGEN'],
    ['pagos/c1/123-recibo.png', 'IMAGEN'],
  ])('%s → %s', (ruta, tipo) => {
    expect(tipoDeComprobante(ruta)).toBe(tipo);
  });

  it('extensiones en mayúsculas o mezcladas', () => {
    expect(tipoDeComprobante('pagos/c1/1-RECIBO.PDF')).toBe('PDF');
    expect(tipoDeComprobante('pagos/c1/1-foto.JpG')).toBe('IMAGEN');
    expect(tipoDeComprobante('pagos/c1/1-foto.PNG')).toBe('IMAGEN');
  });

  it('sin extensión: null', () => {
    expect(tipoDeComprobante('pagos/c1/1-recibo')).toBeNull();
    expect(tipoDeComprobante('pagos/c1/1-recibo.')).toBeNull();
  });

  it('un archivo oculto sin nombre (".pdf") no tiene extensión', () => {
    expect(tipoDeComprobante('pagos/c1/.pdf')).toBeNull();
  });

  it('ruta nula, indefinida o vacía: null', () => {
    expect(tipoDeComprobante(null)).toBeNull();
    expect(tipoDeComprobante(undefined)).toBeNull();
    expect(tipoDeComprobante('')).toBeNull();
  });

  it('otras extensiones: null', () => {
    expect(tipoDeComprobante('pagos/c1/1-recibo.docx')).toBeNull();
    expect(tipoDeComprobante('pagos/c1/1-recibo.heic')).toBeNull();
    expect(tipoDeComprobante('pagos/c1/1-video.mp4')).toBeNull();
  });

  it('doble extensión: manda la última', () => {
    expect(tipoDeComprobante('pagos/c1/1-recibo.pdf.png')).toBe('IMAGEN');
    expect(tipoDeComprobante('pagos/c1/1-foto.png.pdf')).toBe('PDF');
    expect(tipoDeComprobante('pagos/c1/1-recibo.pdf.exe')).toBeNull();
  });

  it('un punto en una carpeta no cuenta como extensión del archivo', () => {
    expect(tipoDeComprobante('pagos/c1.pdf/1-recibo')).toBeNull();
  });
});

describe('extensionDeComprobante (según el mimetype ya validado por contenido)', () => {
  it.each([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['application/pdf', '.pdf'],
  ])('%s → %s', (mimetype, extension) => {
    expect(extensionDeComprobante(mimetype)).toBe(extension);
  });

  it('un tipo que no es de comprobante: null', () => {
    expect(extensionDeComprobante('video/mp4')).toBeNull();
    expect(extensionDeComprobante('text/plain')).toBeNull();
    expect(extensionDeComprobante('')).toBeNull();
  });
});
