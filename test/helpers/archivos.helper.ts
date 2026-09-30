/**
 * Archivos mínimos REALES (con la firma binaria correcta) para las pruebas de
 * subida. El backend valida los primeros bytes (B0.5-C): un Buffer de texto
 * declarado como imagen ya no es un archivo válido.
 */
export type TipoArchivoPrueba = 'png' | 'jpeg' | 'pdf' | 'mp4';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const MP4_MINIMO = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isomiso2'),
]);

export const MIMETYPE_DE_PRUEBA: Record<TipoArchivoPrueba, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
};

const BASE: Record<TipoArchivoPrueba, Buffer> = {
  png: PNG_1X1,
  jpeg: JPEG_1X1,
  pdf: PDF_MINIMO,
  mp4: MP4_MINIMO,
};

/**
 * Contenido mínimo válido del tipo pedido. `texto` se agrega al final para que
 * dos archivos de una misma prueba no sean idénticos (los bytes del final no
 * cambian la firma).
 */
export function archivoDePrueba(tipo: TipoArchivoPrueba, texto = ''): Buffer {
  return texto ? Buffer.concat([BASE[tipo], Buffer.from(texto)]) : BASE[tipo];
}

/** Bytes de un ejecutable de Windows (cabecera `MZ`): no es ningún tipo permitido. */
export const EJECUTABLE_FALSO = Buffer.concat([
  Buffer.from('MZ'),
  Buffer.from('este programa no puede ejecutarse en modo DOS'),
]);

/** Texto plano. */
export const TEXTO_PLANO = Buffer.from(
  'esto solo es texto plano, no una imagen',
);
