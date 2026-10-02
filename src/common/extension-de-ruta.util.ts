import { extname } from 'path';

/**
 * Extensión (en minúsculas, con el punto) del ARCHIVO de una ruta guardada. Ruta nula o vacía, sin
 * extensión ("1-foto", "1-foto.") o un archivo oculto sin nombre (".mp4"): `null`. Con doble
 * extensión manda la última; un punto en una carpeta no cuenta.
 */
export function extensionDeRuta(
  ruta: string | null | undefined,
): string | null {
  if (!ruta) {
    return null;
  }
  const extension = extname(ruta).toLowerCase();
  return extension.length > 1 ? extension : null;
}
