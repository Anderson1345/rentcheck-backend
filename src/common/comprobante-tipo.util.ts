import { extensionDeRuta } from './extension-de-ruta.util';

export type ComprobanteTipo = 'IMAGEN' | 'PDF';

/**
 * Tipo del comprobante según la extensión de la ruta guardada (`comprobante_ruta`). Sin migración:
 * sirve para los pagos que ya existen. Los pagos nuevos guardan la extensión según el contenido real
 * (ver `extensionDeComprobante`), así que para ellos es exacto; un pago antiguo cuya extensión no
 * coincidía con su contenido (solo posible con clientes distintos de la app) puede salir mal
 * clasificado. Ruta nula, sin extensión o con otra extensión: `null`. Con doble extensión manda la
 * última.
 */
export function tipoDeComprobante(
  ruta: string | null | undefined,
): ComprobanteTipo | null {
  switch (extensionDeRuta(ruta)) {
    case '.pdf':
      return 'PDF';
    case '.jpg':
    case '.jpeg':
    case '.png':
      return 'IMAGEN';
    default:
      return null;
  }
}

const EXTENSION_POR_MIMETYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

/**
 * Extensión que se guarda para un comprobante, según el mimetype ya validado por el contenido real
 * (B0.5-C). Nunca sale del nombre que manda el cliente. `null` si no es un tipo de comprobante.
 */
export function extensionDeComprobante(mimetype: string): string | null {
  return EXTENSION_POR_MIMETYPE[mimetype] ?? null;
}
