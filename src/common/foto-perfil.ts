import { Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { memoryStorage } from 'multer';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import {
  TAMANO_MAXIMO_FOTO_INVENTARIO,
  TIPOS_ARCHIVO_FOTO_INVENTARIO,
} from './limites-archivo.constants';

type Firmador = Pick<AlmacenamientoService, 'generarUrlFirmada'>;

/**
 * Interceptor de las subidas de foto (cédula y foto principal de unidad): el
 * mismo campo `foto`, tipos y tamaño máximo que la portada del inmueble.
 */
export const interceptorFotoPerfil = () =>
  FileInterceptor('foto', {
    storage: memoryStorage(),
    fileFilter: (_req, file, callback) => {
      if (!TIPOS_ARCHIVO_FOTO_INVENTARIO.includes(file.mimetype)) {
        callback(
          new UnsupportedMediaTypeException(
            'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG o PNG.',
          ),
          false,
        );
        return;
      }
      callback(null, true);
    },
    limits: { fileSize: TAMANO_MAXIMO_FOTO_INVENTARIO },
  });

/**
 * URL firmada de una foto guardada por ruta. Si no hay ruta, si el valor es un
 * `data:` heredado o si falla la firma, devuelve null (y registra la falla):
 * una foto que no se puede firmar nunca tumba la respuesta.
 */
export async function firmarFotoOpcional(
  almacenamiento: Firmador,
  ruta: string | null,
  logger: Logger,
): Promise<string | null> {
  if (!ruta || ruta.startsWith('data:')) {
    return null;
  }
  try {
    return await almacenamiento.generarUrlFirmada(ruta);
  } catch {
    logger.warn(`No se pudo firmar la URL de la foto '${ruta}'.`);
    return null;
  }
}

/** Reemplaza `foto_principal_url` (ruta) por su URL firmada en una unidad. */
export async function conFotoPrincipalFirmada<
  T extends { foto_principal_url: string | null },
>(unidad: T, almacenamiento: Firmador, logger: Logger): Promise<T> {
  return {
    ...unidad,
    foto_principal_url: await firmarFotoOpcional(
      almacenamiento,
      unidad.foto_principal_url,
      logger,
    ),
  };
}

interface OpcionesReemplazo<R> {
  almacenamiento: AlmacenamientoService;
  logger: Logger;
  foto: Express.Multer.File;
  /** Carpeta que el servidor genera para ESA entidad (termina en `/`). */
  prefijo: string;
  /** Inicio del nombre del archivo, p. ej. `cedula`. */
  nombre: string;
  /** Valor guardado hoy; solo se borra si empieza por `prefijo`. */
  rutaAnterior: string | null;
  /** Escribe la ruta nueva en la BD; null si la fila ya no existe. */
  guardar: (rutaNueva: string) => Promise<R | null>;
}

/**
 * Patrón de la portada: la ruta la genera el servidor, la subida va FUERA de
 * transacciones, si la BD falla se borra lo subido y el archivo anterior se
 * borra DESPUÉS de confirmar la BD y solo si es propio (empieza por el
 * prefijo que el servidor genera para esa entidad; un valor heredado como
 * `contratos/...` nunca se toca). Cada foto lleva un nombre único, así que
 * reemplazar nunca pisa el archivo anterior antes de confirmar.
 */
export async function reemplazarFoto<R>(
  opciones: OpcionesReemplazo<R>,
): Promise<R | null> {
  const { almacenamiento, logger, foto, prefijo, nombre, rutaAnterior } =
    opciones;
  const extension = foto.mimetype === 'image/png' ? '.png' : '.jpg';
  const rutaNueva = `${prefijo}${nombre}-${randomUUID()}${extension}`;

  await almacenamiento.subirArchivo(foto.buffer, rutaNueva, foto.mimetype);

  let resultado: R | null;
  try {
    resultado = await opciones.guardar(rutaNueva);
  } catch (error) {
    await borrarSilencioso(almacenamiento, logger, rutaNueva);
    throw error;
  }
  if (resultado === null) {
    await borrarSilencioso(almacenamiento, logger, rutaNueva);
    return null;
  }

  if (
    rutaAnterior &&
    rutaAnterior !== rutaNueva &&
    rutaAnterior.startsWith(prefijo)
  ) {
    await borrarSilencioso(almacenamiento, logger, rutaAnterior);
  }
  return resultado;
}

async function borrarSilencioso(
  almacenamiento: AlmacenamientoService,
  logger: Logger,
  ruta: string,
): Promise<void> {
  try {
    await almacenamiento.eliminarArchivo(ruta);
  } catch {
    logger.warn(`No se pudo eliminar el archivo '${ruta}' del bucket.`);
  }
}

/**
 * Firma `foto_principal_url` de la `unidad` anidada de una respuesta (contrato,
 * solicitud, pago...). Si el objeto no trae ese campo, lo devuelve igual.
 */
export async function conFotoDeUnidadAnidada<T extends object>(
  objeto: T,
  almacenamiento: Firmador,
  logger: Logger,
): Promise<T> {
  const unidad = (objeto as { unidad?: unknown }).unidad;
  if (
    !unidad ||
    typeof unidad !== 'object' ||
    !('foto_principal_url' in unidad)
  ) {
    return objeto;
  }
  return {
    ...objeto,
    unidad: await conFotoPrincipalFirmada(
      unidad as { foto_principal_url: string | null },
      almacenamiento,
      logger,
    ),
  };
}
