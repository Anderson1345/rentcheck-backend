import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  detectarTipoArchivo,
  validarContenidoArchivo,
} from './validar-contenido-archivo';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const PDF = Buffer.from('%PDF-1.7\n...');
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypmp42'),
]);
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic'),
]);

function archivo(
  buffer: Buffer,
  mimetype: string,
  originalname = 'x.bin',
): Express.Multer.File {
  return { buffer, mimetype, originalname } as Express.Multer.File;
}

describe('detectarTipoArchivo', () => {
  it('reconoce PNG, JPEG, PDF y MP4 por sus primeros bytes', () => {
    expect(detectarTipoArchivo(PNG)).toEqual({
      mimetype: 'image/png',
      extension: '.png',
    });
    expect(detectarTipoArchivo(JPEG)).toEqual({
      mimetype: 'image/jpeg',
      extension: '.jpg',
    });
    expect(detectarTipoArchivo(PDF)).toEqual({
      mimetype: 'application/pdf',
      extension: '.pdf',
    });
    expect(detectarTipoArchivo(MP4)).toEqual({
      mimetype: 'video/mp4',
      extension: '.mp4',
    });
  });

  it('no reconoce texto, ejecutables, vacíos, truncados ni imágenes HEIC', () => {
    expect(detectarTipoArchivo(Buffer.from('hola mundo'))).toBeNull();
    expect(detectarTipoArchivo(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(detectarTipoArchivo(Buffer.alloc(0))).toBeNull();
    expect(detectarTipoArchivo(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(detectarTipoArchivo(Buffer.from('%PDF'))).toBeNull();
    expect(detectarTipoArchivo(HEIC)).toBeNull();
  });
});

describe('validarContenidoArchivo', () => {
  const IMAGENES = ['image/jpeg', 'image/png'];

  it('acepta un archivo cuyo contenido coincide con el declarado y está permitido', () => {
    const f = archivo(PNG, 'image/png', 'foto.PNG');
    expect(() => validarContenidoArchivo(f, IMAGENES)).not.toThrow();
  });

  it('la extensión y el mimetype salen del tipo detectado, no del nombre del cliente', () => {
    const f = archivo(PNG, 'image/png', 'virus.exe');
    validarContenidoArchivo(f, IMAGENES);
    expect(f.originalname).toBe('virus.png');
    expect(f.mimetype).toBe('image/png');
    const sinNombre = archivo(JPEG, 'image/jpeg', '');
    validarContenidoArchivo(sinNombre, IMAGENES);
    expect(sinNombre.originalname).toBe('archivo.jpg');
  });

  it.each([
    ['texto declarado png', Buffer.from('texto'), 'image/png'],
    ['ejecutable declarado jpeg', Buffer.from('MZ\x90'), 'image/jpeg'],
    ['PDF declarado jpeg', PDF, 'image/jpeg'],
    ['PNG declarado jpeg', PNG, 'image/jpeg'],
    ['JPEG declarado png', JPEG, 'image/png'],
    ['vacío declarado png', Buffer.alloc(0), 'image/png'],
  ])('rechaza %s con ARCHIVO_CONTENIDO_INVALIDO', (_nombre, buffer, tipo) => {
    let error: unknown;
    try {
      validarContenidoArchivo(archivo(buffer, tipo), IMAGENES);
    } catch (e) {
      error = e;
    }
    const respuesta = (
      error as { getResponse?: () => Record<string, unknown> }
    ).getResponse?.();
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(415);
    expect(respuesta?.codigo).toBe('ARCHIVO_CONTENIDO_INVALIDO');
    expect(typeof respuesta?.mensaje).toBe('string');
  });

  it('rechaza un tipo real que el endpoint no permite aunque coincida con lo declarado', () => {
    expect(() =>
      validarContenidoArchivo(archivo(PDF, 'application/pdf'), IMAGENES),
    ).toThrow();
  });
});

/**
 * Guardia estructural: todo controlador con un endpoint de subida (multer)
 * debe enganchar el validador de contenido en CADA endpoint de subida.
 */
describe('todo endpoint de subida pasa por el validador de contenido', () => {
  const raiz = join(__dirname, '..');
  const controladores: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) {
        recorrer(ruta);
      } else if (nombre.endsWith('.controller.ts')) {
        controladores.push(ruta);
      }
    }
  };
  recorrer(raiz);

  it('cada FileInterceptor / interceptorFotoPerfil tiene su interceptorContenidoArchivo', () => {
    let subidas = 0;
    for (const ruta of controladores) {
      const fuente = readFileSync(ruta, 'utf8');
      const enSubidas = (
        fuente.match(/FileInterceptor\(|\.\.\.interceptorFotoPerfil\(/g) ?? []
      ).length;
      const usoDirecto = (fuente.match(/[^.]interceptorFotoPerfil\(\)/g) ?? [])
        .length;
      const validadores = (fuente.match(/interceptorContenidoArchivo\(/g) ?? [])
        .length;
      subidas += enSubidas;
      // Un endpoint de subida = un validador (los de foto de perfil lo traen incluido).
      expect([ruta, usoDirecto]).toEqual([ruta, 0]);
      const soloMulter = (fuente.match(/FileInterceptor\(/g) ?? []).length;
      expect([ruta, validadores]).toEqual([ruta, soloMulter]);
    }
    // arrendador(1) + inmueble(3: documentos, portada, foto-principal) + pago + solicitud + inventario + inquilino perfil
    expect(subidas).toBe(8);
  });
});
