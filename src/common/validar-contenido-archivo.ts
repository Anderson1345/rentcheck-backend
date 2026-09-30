import {
  CallHandler,
  ExecutionContext,
  Injectable,
  mixin,
  NestInterceptor,
  Type,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { basename, extname } from 'path';

export interface TipoDetectado {
  mimetype: string;
  extension: string;
}

const JPEG: TipoDetectado = { mimetype: 'image/jpeg', extension: '.jpg' };
const PNG: TipoDetectado = { mimetype: 'image/png', extension: '.png' };
const PDF: TipoDetectado = { mimetype: 'application/pdf', extension: '.pdf' };
const MP4: TipoDetectado = { mimetype: 'video/mp4', extension: '.mp4' };

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const FIRMA_PDF = Buffer.from('%PDF-', 'latin1');

/**
 * Marcas (`major brand`) de contenedores ISO-BMFF que NO son video MP4
 * (imágenes HEIC/AVIF): comparten la caja `ftyp` pero ningún endpoint las permite.
 */
const MARCAS_ISOBMFF_DE_IMAGEN = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
  'avif',
  'avis',
]);

function empiezaPor(buffer: Buffer, firma: Buffer, desde = 0): boolean {
  return (
    buffer.length >= desde + firma.length &&
    buffer.subarray(desde, desde + firma.length).equals(firma)
  );
}

/**
 * Tipo real de un archivo según sus primeros bytes (JPEG, PNG, PDF y MP4, los
 * únicos tipos que algún endpoint de subida permite). null si no coincide con
 * ninguno. Nunca se confía en el mimetype ni en el nombre que manda el cliente.
 */
export function detectarTipoArchivo(buffer: Buffer): TipoDetectado | null {
  if (empiezaPor(buffer, FIRMA_PNG)) {
    return PNG;
  }
  if (empiezaPor(buffer, FIRMA_JPEG)) {
    return JPEG;
  }
  if (empiezaPor(buffer, FIRMA_PDF)) {
    return PDF;
  }
  // MP4: caja `ftyp` en los bytes 4..8 (los 4 primeros son el tamaño de la caja).
  if (buffer.length >= 12 && empiezaPor(buffer, Buffer.from('ftyp'), 4)) {
    const marca = buffer.subarray(8, 12).toString('latin1').toLowerCase();
    return MARCAS_ISOBMFF_DE_IMAGEN.has(marca) ? null : MP4;
  }
  return null;
}

const MENSAJE_CONTENIDO_INVALIDO =
  'El contenido del archivo no corresponde al tipo indicado o no es un tipo permitido.';

function contenidoInvalido(): UnsupportedMediaTypeException {
  return new UnsupportedMediaTypeException({
    codigo: 'ARCHIVO_CONTENIDO_INVALIDO',
    mensaje: MENSAJE_CONTENIDO_INVALIDO,
  });
}

/**
 * Valida un archivo ya leído por multer: el tipo DETECTADO debe ser uno de los
 * `permitidos` y coincidir con el mimetype declarado. Si no, 415
 * `ARCHIVO_CONTENIDO_INVALIDO` (antes de tocar el bucket o la base). Si pasa,
 * el mimetype y la extensión del nombre pasan a ser los del tipo detectado:
 * la ruta guardada y el Content-Type del bucket nunca salen del nombre que
 * manda el cliente.
 */
export function validarContenidoArchivo(
  archivo: Express.Multer.File,
  permitidos: string[],
): TipoDetectado {
  const detectado = detectarTipoArchivo(archivo.buffer);
  if (
    !detectado ||
    !permitidos.includes(detectado.mimetype) ||
    detectado.mimetype !== archivo.mimetype
  ) {
    throw contenidoInvalido();
  }
  const nombre = archivo.originalname ?? '';
  const base = basename(nombre, extname(nombre)) || 'archivo';
  archivo.mimetype = detectado.mimetype;
  archivo.originalname = `${base}${detectado.extension}`;
  return detectado;
}

/**
 * Interceptor que valida `req.file` (después del `FileInterceptor`). TODO
 * endpoint de subida lo engancha con los mismos tipos que permite su
 * `fileFilter`. Sin archivo (adjunto opcional) no hace nada.
 */
export function interceptorContenidoArchivo(
  permitidos: string[],
): Type<NestInterceptor> {
  @Injectable()
  class InterceptorContenidoArchivo implements NestInterceptor {
    intercept(contexto: ExecutionContext, siguiente: CallHandler) {
      const peticion = contexto
        .switchToHttp()
        .getRequest<{ file?: Express.Multer.File }>();
      if (peticion.file) {
        validarContenidoArchivo(peticion.file, permitidos);
      }
      return siguiente.handle();
    }
  }
  return mixin(InterceptorContenidoArchivo);
}
