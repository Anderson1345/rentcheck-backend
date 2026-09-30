import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  archivoDePrueba,
  EJECUTABLE_FALSO,
  MIMETYPE_DE_PRUEBA,
  TEXTO_PLANO,
  TipoArchivoPrueba,
} from './helpers/archivos.helper';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  fechaHoyLocal,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const TIPO_NO_SOPORTADO: number = HttpStatus.UNSUPPORTED_MEDIA_TYPE;

interface CuerpoError {
  codigo?: string;
  mensaje?: string;
}

/** Un endpoint de subida: cómo llamarlo y cómo medir que NO se escribió nada. */
interface EndpointSubida {
  nombre: string;
  campo: string;
  permitidos: TipoArchivoPrueba[];
  ruta: string;
  token: string;
  campos: Record<string, string>;
  /** Estado de la base relevante: no debe cambiar ante un rechazo. */
  estado: () => Promise<string>;
}

describe('Validación del contenido real de los archivos subidos (B0.5-C, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;

  beforeEach(async () => {
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<INestApplication<App>>();
    configurarApp(app);
    almacenamiento = modulo.get(AlmacenamientoService);
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  async function endpoints(): Promise<EndpointSubida[]> {
    const arr = await registrarArrendador(
      app,
      'Arrendador Contenido',
      'contenido-arr@correo.com',
    );
    const inmueble = await crearInmueble(app, arr.access_token);
    const unidadId = inmueble.unidades[0].id;
    const ficha = await crearInquilino(app, arr.access_token);
    const contrato = await crearContrato(
      app,
      arr.access_token,
      unidadId,
      ficha.id,
    );
    const inq = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'contenido-inq@correo.com',
    );
    const IMAGENES: TipoArchivoPrueba[] = ['jpeg', 'png'];
    const IMAGENES_Y_PDF: TipoArchivoPrueba[] = ['jpeg', 'png', 'pdf'];

    return [
      {
        nombre: 'foto de cédula del arrendador',
        campo: 'foto',
        permitidos: IMAGENES,
        ruta: '/arrendadores/perfil/foto-cedula',
        token: arr.access_token,
        campos: {},
        estado: async () =>
          JSON.stringify(
            await prisma.arrendador.findFirst({
              select: { foto_cedula_nit_url: true },
            }),
          ),
      },
      {
        nombre: 'foto de cédula del inquilino',
        campo: 'foto',
        permitidos: IMAGENES,
        ruta: '/inquilino/perfil/foto-cedula',
        token: inq,
        campos: {},
        estado: async () =>
          JSON.stringify(
            await prisma.inquilino.findFirst({
              select: { foto_cedula_url: true },
            }),
          ),
      },
      {
        nombre: 'foto principal de la unidad',
        campo: 'foto',
        permitidos: IMAGENES,
        ruta: `/inmuebles/${inmueble.id}/unidades/${unidadId}/foto-principal`,
        token: arr.access_token,
        campos: {},
        estado: async () =>
          JSON.stringify(
            await prisma.unidad.findUnique({
              where: { id: unidadId },
              select: { foto_principal_url: true },
            }),
          ),
      },
      {
        nombre: 'portada del inmueble',
        campo: 'foto',
        permitidos: IMAGENES,
        ruta: `/inmuebles/${inmueble.id}/foto-portada`,
        token: arr.access_token,
        campos: {},
        estado: async () =>
          JSON.stringify(
            await prisma.inmueble.findUnique({
              where: { id: inmueble.id },
              select: { foto_portada_ruta: true },
            }),
          ),
      },
      {
        nombre: 'documento del inmueble',
        campo: 'archivo',
        permitidos: IMAGENES_Y_PDF,
        ruta: `/inmuebles/${inmueble.id}/documentos`,
        token: arr.access_token,
        campos: { tipo: 'RECIBO_PREDIAL' },
        estado: async () => String(await prisma.documentoInmueble.count()),
      },
      {
        nombre: 'comprobante de pago',
        campo: 'comprobante',
        permitidos: IMAGENES_Y_PDF,
        ruta: '/pagos',
        token: inq,
        campos: {
          contratoId: contrato.id,
          monto_centavos: '1000000',
          fecha_reportada: fechaHoyLocal(),
        },
        estado: async () => String(await prisma.pago.count()),
      },
      {
        nombre: 'adjunto de solicitud de mantenimiento',
        campo: 'adjunto',
        permitidos: ['jpeg', 'png', 'mp4'],
        ruta: '/solicitudes-mantenimiento',
        token: inq,
        campos: {
          unidadId,
          descripcion: 'El lavadero tiene una fuga de agua.',
          urgencia: 'ALTO',
        },
        estado: async () => String(await prisma.solicitudMantenimiento.count()),
      },
      {
        nombre: 'foto de inventario',
        campo: 'foto',
        permitidos: IMAGENES,
        ruta: `/contratos/${contrato.id}/fotos-inventario`,
        token: arr.access_token,
        campos: { momento: 'ENTREGA', zona: 'Cocina' },
        estado: async () => String(await prisma.fotoInventario.count()),
      },
    ];
  }

  function subir(
    e: EndpointSubida,
    contenido: Buffer,
    mimetype: string,
    nombre: string,
  ) {
    let peticion = request(app.getHttpServer())
      .post(e.ruta)
      .set('Authorization', `Bearer ${e.token}`);
    for (const [clave, valor] of Object.entries(e.campos)) {
      peticion = peticion.field(clave, valor);
    }
    return peticion.attach(e.campo, contenido, {
      filename: nombre,
      contentType: mimetype,
    });
  }

  const codigoError = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  it('cada endpoint de subida acepta los tipos permitidos con contenido real; la ruta y el Content-Type salen del tipo detectado, no del nombre del cliente', async () => {
    const subidas = jest.spyOn(almacenamiento, 'subirArchivo');
    for (const e of await endpoints()) {
      for (const tipo of e.permitidos) {
        subidas.mockClear();
        const r = await subir(
          e,
          archivoDePrueba(tipo, ` ${e.nombre}`),
          MIMETYPE_DE_PRUEBA[tipo],
          // El cliente miente con el nombre: la extensión guardada no puede salir de aquí.
          'archivo-con-otro-nombre.exe',
        );
        expect([e.nombre, tipo, r.status < 300]).toEqual([
          e.nombre,
          tipo,
          true,
        ]);
        expect(subidas).toHaveBeenCalledTimes(1);
        const [, ruta, tipoMime] = subidas.mock.calls[0];
        const extension = {
          png: '.png',
          jpeg: '.jpg',
          pdf: '.pdf',
          mp4: '.mp4',
        }[tipo];
        expect([e.nombre, tipo, ruta.endsWith(extension)]).toEqual([
          e.nombre,
          tipo,
          true,
        ]);
        expect(ruta).not.toContain('.exe');
        expect(tipoMime).toBe(MIMETYPE_DE_PRUEBA[tipo]);
      }
    }
  }, 300000);

  it('contenido que no es del tipo declarado (texto o ejecutable declarado como imagen/PDF) es 415 ARCHIVO_CONTENIDO_INVALIDO y no escribe nada en el bucket ni en la base', async () => {
    const lista = await endpoints();
    const subidas = jest.spyOn(almacenamiento, 'subirArchivo');
    for (const e of lista) {
      const antes = await e.estado();
      for (const tipo of e.permitidos) {
        for (const falso of [TEXTO_PLANO, EJECUTABLE_FALSO]) {
          const r = await subir(
            e,
            falso,
            MIMETYPE_DE_PRUEBA[tipo],
            'falso.png',
          );
          expect([e.nombre, tipo, r.status, codigoError(r)]).toEqual([
            e.nombre,
            tipo,
            TIPO_NO_SOPORTADO,
            'ARCHIVO_CONTENIDO_INVALIDO',
          ]);
          expect(typeof (r.body as CuerpoError).mensaje).toBe('string');
        }
      }
      expect([e.nombre, await e.estado()]).toEqual([e.nombre, antes]);
    }
    expect(subidas).not.toHaveBeenCalled();
  }, 300000);

  it('contenido real de un tipo declarado con OTRO mimetype (aunque ambos sean permitidos) es rechazado', async () => {
    const lista = await endpoints();
    const subidas = jest.spyOn(almacenamiento, 'subirArchivo');
    for (const e of lista) {
      const antes = await e.estado();
      for (const real of e.permitidos) {
        for (const declarado of e.permitidos) {
          if (real === declarado) {
            continue;
          }
          const r = await subir(
            e,
            archivoDePrueba(real),
            MIMETYPE_DE_PRUEBA[declarado],
            'archivo',
          );
          expect([e.nombre, real, declarado, r.status, codigoError(r)]).toEqual(
            [
              e.nombre,
              real,
              declarado,
              TIPO_NO_SOPORTADO,
              'ARCHIVO_CONTENIDO_INVALIDO',
            ],
          );
        }
      }
      // Un tipo real que el endpoint no permite (PDF en un endpoint de imágenes; MP4 en los demás).
      for (const noPermitido of ['pdf', 'mp4'] as TipoArchivoPrueba[]) {
        if (e.permitidos.includes(noPermitido)) {
          continue;
        }
        const r = await subir(
          e,
          archivoDePrueba(noPermitido),
          MIMETYPE_DE_PRUEBA[noPermitido],
          'archivo',
        );
        expect([e.nombre, noPermitido, r.status]).toEqual([
          e.nombre,
          noPermitido,
          TIPO_NO_SOPORTADO,
        ]);
      }
      expect([e.nombre, await e.estado()]).toEqual([e.nombre, antes]);
    }
    expect(subidas).not.toHaveBeenCalled();
  }, 300000);
});
