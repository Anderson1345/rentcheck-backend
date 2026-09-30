import { Logger } from '@nestjs/common';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';

type Firmador = Pick<AlmacenamientoService, 'generarUrlFirmada'>;

/**
 * Única forma de firmar la URL de un archivo al armar una respuesta (B-37).
 *
 * Un archivo que no se puede firmar (borrado del bucket, bucket caído, ruta
 * corrupta) nunca tumba la respuesta completa: el campo sale null y queda un
 * aviso en el registro. `contexto` dice QUÉ se firmaba (p. ej. "comprobante del
 * pago <id>"): el aviso nunca incluye la URL firmada, la ruta del bucket ni el
 * mensaje del error del proveedor (que puede traerlas).
 *
 * - `ruta` null/vacía → null, sin tocar el bucket.
 * - Falla la firma → `logger.warn` con el contexto y null.
 */
export async function firmarTolerante(
  almacenamiento: Firmador,
  ruta: string | null | undefined,
  logger: Logger,
  contexto: string,
): Promise<string | null> {
  if (!ruta) {
    return null;
  }
  try {
    return await almacenamiento.generarUrlFirmada(ruta);
  } catch {
    logger.warn(`No se pudo firmar la URL de ${contexto}.`);
    return null;
  }
}
