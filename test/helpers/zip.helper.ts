import { inflateRawSync } from 'zlib';

/**
 * Lector mínimo de ZIP para las pruebas: usa el directorio central (los
 * tamaños del encabezado local vienen en cero cuando el ZIP se genera por
 * flujo) y descomprime las entradas almacenadas o con deflate.
 */
export function leerZip(zip: Buffer): Map<string, Buffer> {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) {
    eocd -= 1;
  }
  if (eocd < 0) {
    throw new Error('No es un ZIP válido (falta el directorio central).');
  }
  const total = zip.readUInt16LE(eocd + 10);
  let posicion = zip.readUInt32LE(eocd + 16);
  const entradas = new Map<string, Buffer>();

  for (let i = 0; i < total; i += 1) {
    if (zip.readUInt32LE(posicion) !== 0x02014b50) {
      throw new Error('Directorio central corrupto.');
    }
    const metodo = zip.readUInt16LE(posicion + 10);
    const tamanoComprimido = zip.readUInt32LE(posicion + 20);
    const largoNombre = zip.readUInt16LE(posicion + 28);
    const largoExtra = zip.readUInt16LE(posicion + 30);
    const largoComentario = zip.readUInt16LE(posicion + 32);
    const desplazamientoLocal = zip.readUInt32LE(posicion + 42);
    const nombre = zip.toString(
      'utf8',
      posicion + 46,
      posicion + 46 + largoNombre,
    );

    if (zip.readUInt32LE(desplazamientoLocal) !== 0x04034b50) {
      throw new Error(`Encabezado local corrupto para ${nombre}.`);
    }
    const largoNombreLocal = zip.readUInt16LE(desplazamientoLocal + 26);
    const largoExtraLocal = zip.readUInt16LE(desplazamientoLocal + 28);
    const inicio =
      desplazamientoLocal + 30 + largoNombreLocal + largoExtraLocal;
    const datos = zip.subarray(inicio, inicio + tamanoComprimido);
    entradas.set(
      nombre,
      metodo === 8 ? inflateRawSync(datos) : Buffer.from(datos),
    );

    posicion += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}
