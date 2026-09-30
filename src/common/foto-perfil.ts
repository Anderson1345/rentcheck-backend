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
 * URL firmada de una foto de perfil o de unidad, SOLO si su ruta pertenece a la
 * entidad (empieza por `prefijo`, el mismo que generan las subidas). Cualquier
 * otro valor (heredado como `contratos/...`, de otra entidad, `data:` o texto
 * suelto) devuelve null sin firmarse y deja un aviso en el registro (sin la
 * ruta guardada). Si falla la firma también devuelve null: una foto nunca
 * tumba la respuesta.
 */
export async function firmarFotoOpcional(
  almacenamiento: Firmador,
  ruta: string | null,
  prefijo: string,
  logger: Logger,
): Promise<string | null> {
  if (!ruta) {
    return null;
  }
  if (!ruta.startsWith(prefijo)) {
    logger.warn(
      `Foto ignorada: la ruta guardada no pertenece a la entidad (prefijo esperado '${prefijo}').`,
    );
    return null;
  }
  try {
    return await almacenamiento.generarUrlFirmada(ruta);
  } catch {
    logger.warn(`No se pudo firmar la URL de la foto '${ruta}'.`);
    return null;
  }
}

/** Prefijo que generan las subidas de la foto principal de una unidad. */
export const prefijoFotoUnidad = (inmuebleId: string, unidadId: string) =>
  `inmuebles/${inmuebleId}/unidades/${unidadId}/`;

/**
 * Reemplaza `foto_principal_url` (ruta) por su URL firmada en una unidad, solo
 * si la ruta pertenece a esa unidad (`inmuebles/<inmueble_id>/unidades/<id>/`).
 */
export async function conFotoPrincipalFirmada<
  T extends {
    id: string;
    inmueble_id: string;
    foto_principal_url: string | null;
  },
>(unidad: T, almacenamiento: Firmador, logger: Logger): Promise<T> {
  return {
    ...unidad,
    foto_principal_url: await firmarFotoOpcional(
      almacenamiento,
      unidad.foto_principal_url,
      prefijoFotoUnidad(unidad.inmueble_id, unidad.id),
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
 * solicitud, pago...), solo si la ruta pertenece a esa unidad. Con
 * `inmueble_id` se exige el prefijo exacto; sin él, que la ruta empiece por
 * `inmuebles/` y contenga `/unidades/<unidad.id>/`. Si el objeto anidado no
 * trae el id de la unidad no se firma nada. Si no trae el campo, se devuelve
 * igual.
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
  const datos = unidad as {
    id?: unknown;
    inmueble_id?: unknown;
    foto_principal_url: string | null;
  };
  const prefijo = prefijoDeUnidadAnidada(datos);
  return {
    ...objeto,
    unidad: {
      ...unidad,
      foto_principal_url: prefijo
        ? await firmarFotoOpcional(
            almacenamiento,
            datos.foto_principal_url,
            prefijo,
            logger,
          )
        : null,
    },
  };
}

function prefijoDeUnidadAnidada(unidad: {
  id?: unknown;
  inmueble_id?: unknown;
  foto_principal_url: string | null;
}): string | null {
  if (typeof unidad.id !== 'string') {
    return null;
  }
  if (typeof unidad.inmueble_id === 'string') {
    return prefijoFotoUnidad(unidad.inmueble_id, unidad.id);
  }
  const ruta = unidad.foto_principal_url;
  const marca = `/unidades/${unidad.id}/`;
  if (!ruta || !ruta.startsWith('inmuebles/')) {
    return null;
  }
  const posicion = ruta.indexOf(marca);
  return posicion < 0 ? null : ruta.slice(0, posicion + marca.length);
}
