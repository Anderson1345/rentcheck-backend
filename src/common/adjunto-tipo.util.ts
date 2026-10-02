import { extensionDeRuta } from './extension-de-ruta.util';

export type AdjuntoTipo = 'IMAGEN' | 'VIDEO';

/**
 * Tipo del adjunto de una solicitud de mantenimiento según la extensión de la ruta guardada
 * (`adjunto_ruta`). Sin migración: sirve para las solicitudes que ya existen. Las solicitudes nuevas
 * guardan la extensión según el contenido real (ver `extensionDeAdjunto`), así que para ellas es
 * exacto; una solicitud antigua cuya extensión no coincidía con su contenido (solo posible con
 * clientes distintos de la app, o antes del validador de B0.5-C) puede salir mal clasificada. Ruta
 * nula, sin extensión o con otra extensión (p. ej. `.mov`): `null`. Con doble extensión manda la última.
 */
export function tipoDeAdjunto(
  ruta: string | null | undefined,
): AdjuntoTipo | null {
  switch (extensionDeRuta(ruta)) {
    case '.jpg':
    case '.jpeg':
    case '.png':
      return 'IMAGEN';
    case '.mp4':
      return 'VIDEO';
    default:
      return null;
  }
}

const EXTENSION_POR_MIMETYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'video/mp4': '.mp4',
};

/**
 * Extensión que se guarda para un adjunto, según el mimetype ya validado por el contenido real
 * (B0.5-C). Nunca sale del nombre que manda el cliente. `null` si no es un tipo de adjunto.
 */
export function extensionDeAdjunto(mimetype: string): string | null {
  return EXTENSION_POR_MIMETYPE[mimetype] ?? null;
}
