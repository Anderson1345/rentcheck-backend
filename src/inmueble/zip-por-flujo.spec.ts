import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Prueba de estructura (complementa la prueba e2e del flujo real): el ZIP ya
 * no se arma en memoria. El método devuelve el flujo sin esperar a que termine
 * el ZIP y el archivo no acumula chunks ni concatena buffers.
 */
describe('construirZipDocumentos (estructura)', () => {
  const fuente = readFileSync(join(__dirname, 'inmueble.service.ts'), 'utf8');
  const inicio = fuente.indexOf('async construirZipDocumentos(');
  const fin = fuente.indexOf('private obtenerInmuebleParaDescarga', inicio);
  const metodo = fuente.slice(inicio, fin);

  it('encontró el método', () => {
    expect(inicio).toBeGreaterThan(0);
    expect(metodo.length).toBeGreaterThan(100);
  });

  it('no espera el cierre del ZIP dentro del método (el flujo se devuelve ya conectado)', () => {
    expect(metodo).not.toMatch(/await\s+archivo\.finalize\(\)/);
    expect(metodo).toMatch(/\.pipe\(/);
  });

  it('no acumula el ZIP ni los archivos en memoria', () => {
    expect(fuente).not.toMatch(/Buffer\.concat/);
    expect(fuente).not.toMatch(/chunks/);
    expect(fuente).not.toMatch(/archivosFallidos\.push\(\s*ruta/);
  });
});
