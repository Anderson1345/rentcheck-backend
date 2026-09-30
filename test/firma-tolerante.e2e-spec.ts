import { HttpStatus, INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
  reportarPago,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const OK: number = HttpStatus.OK;
const CREADO: number = HttpStatus.CREATED;
const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;

type Obj = Record<string, unknown>;

describe('Firma de URLs tolerante a fallos (B-37, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;
  let contador = 0;
  let salida: string[];

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

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  async function escenario() {
    contador += 1;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador Firma ${contador}`,
      `firma-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `FIR-${contador}`);
    const ficha = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      ficha.id,
    );
    return {
      arr: access_token,
      inmuebleId: inmueble.id,
      unidadId: inmueble.unidades[0].id,
      ficha: ficha.id,
      contratoId: contrato.id,
      codigo: contrato.codigo_acceso?.codigo ?? '',
    };
  }

  const get = (token: string, ruta: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

  /** Hace fallar `generarUrlFirmada` SOLO para las rutas indicadas. */
  function fallarEn(rutas: string[]) {
    const prototipo = Object.getPrototypeOf(
      almacenamiento,
    ) as AlmacenamientoService;
    return jest
      .spyOn(almacenamiento, 'generarUrlFirmada')
      .mockImplementation(async (ruta: string, expiracion?: number) => {
        if (rutas.includes(ruta)) {
          throw new Error('firma caída (simulada)');
        }
        return (await prototipo.generarUrlFirmada.call(
          almacenamiento,
          ruta,
          expiracion,
        )) as string;
      });
  }

  /** Captura todo lo que el servidor escribe en los logs. */
  function capturarLogs() {
    salida = [];
    const capturar = (...partes: unknown[]) => {
      salida.push(partes.map((p) => String(p)).join(' '));
      return true;
    };
    jest.spyOn(process.stdout, 'write').mockImplementation(capturar);
    jest.spyOn(process.stderr, 'write').mockImplementation(capturar);
    for (const metodo of [
      'log',
      'warn',
      'error',
      'debug',
      'verbose',
    ] as const) {
      jest.spyOn(Logger.prototype, metodo).mockImplementation(capturar);
    }
  }

  /** Ninguna URL firmada ni token en los logs. */
  function sinUrlsEnLosLogs() {
    const todo = salida.join('\n');
    expect(todo).not.toMatch(/supabase\.co\/storage/);
    expect(todo).not.toMatch(/object\/sign/);
    expect(todo).not.toMatch(/token=/);
    // Sí queda un aviso del fallo, con el contexto de la entidad.
    expect(todo).toMatch(/No se pudo firmar/);
  }

  const conUrl = (lista: Obj[], campo: string) =>
    lista.filter((x) => typeof x[campo] === 'string');
  const sinUrl = (lista: Obj[], campo: string) =>
    lista.filter((x) => x[campo] === null);

  // ------------------------------------------------------------------
  // Pagos
  // ------------------------------------------------------------------
  it('pagos: un comprobante que no se puede firmar sale null en el listado y el detalle; los demás traen URL; crear sigue funcionando', async () => {
    const { arr, codigo, contratoId } = await escenario();
    const inq = await autenticarInquilino(
      app,
      codigo,
      `firma-inq-${contador}@correo.com`,
    );
    const p1 = await reportarPago(app, inq, contratoId);
    const p2 = await reportarPago(app, inq, contratoId);
    const filas = await prisma.pago.findMany({
      where: { contrato_id: contratoId },
    });
    expect(filas).toHaveLength(2);
    const rutaRota = filas.find((f) => f.id === p1.id)?.comprobante_ruta ?? '';
    capturarLogs();
    fallarEn([rutaRota]);

    const listado = (await get(arr, '/pagos').expect(OK)).body as Obj[];
    expect(listado).toHaveLength(2);
    expect(sinUrl(listado, 'comprobante_url').map((x) => x.id)).toEqual([
      p1.id,
    ]);
    expect(conUrl(listado, 'comprobante_url').map((x) => x.id)).toEqual([
      p2.id,
    ]);
    expect(conUrl(listado, 'comprobante_url')[0].comprobante_url).toMatch(
      URL_FIRMADA,
    );
    expect(JSON.stringify(listado)).not.toContain('comprobante_ruta');

    const detalle = (await get(arr, `/pagos/${p1.id}`).expect(OK)).body as Obj;
    expect(detalle.comprobante_url).toBeNull();

    const mios = (await get(inq, '/pagos/mios').expect(OK)).body as Obj[];
    expect(sinUrl(mios, 'comprobante_url')).toHaveLength(1);

    // Crear un pago con la firma caída: el pago se crea y responde 201 con la URL null.
    jest.restoreAllMocks();
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    jest
      .spyOn(almacenamiento, 'generarUrlFirmada')
      .mockRejectedValue(new Error('firma caída (simulada)'));
    const nuevo = await reportarPago(app, inq, contratoId);
    expect(nuevo.id).toEqual(expect.any(String));

    jest.restoreAllMocks();
    sinUrlsEnLosLogs();
  }, 240000);

  // ------------------------------------------------------------------
  // Contratos
  // ------------------------------------------------------------------
  it('contratos: un PDF heredado que no se puede firmar sale null en el listado y el detalle', async () => {
    const a = await escenario();
    const inmueble2 = await crearInmueble(app, a.arr, `FIR2-${contador}`);
    const contrato2 = await crearContrato(
      app,
      a.arr,
      inmueble2.unidades[0].id,
      a.ficha,
    );
    const filas = await prisma.contrato.findMany({
      where: { id: { in: [a.contratoId, contrato2.id] } },
    });
    const rutaRota =
      filas.find((f) => f.id === a.contratoId)?.pdf_contrato_ruta ?? '';
    expect(rutaRota).toBeTruthy();
    capturarLogs();
    fallarEn([rutaRota]);

    const listado = (await get(a.arr, '/contratos').expect(OK)).body as Obj[];
    expect(listado).toHaveLength(2);
    expect(sinUrl(listado, 'pdf_contrato_url').map((x) => x.id)).toEqual([
      a.contratoId,
    ]);
    expect(conUrl(listado, 'pdf_contrato_url').map((x) => x.id)).toEqual([
      contrato2.id,
    ]);

    const detalle = (await get(a.arr, `/contratos/${a.contratoId}`).expect(OK))
      .body as Obj;
    expect(detalle.pdf_contrato_url).toBeNull();
    const otro = (await get(a.arr, `/contratos/${contrato2.id}`).expect(OK))
      .body as Obj;
    expect(otro.pdf_contrato_url).toMatch(URL_FIRMADA);

    jest.restoreAllMocks();
    sinUrlsEnLosLogs();
  }, 240000);

  // ------------------------------------------------------------------
  // Inmuebles: portada y documentos
  // ------------------------------------------------------------------
  it('inmueble: una portada o un documento que no se puede firmar sale null; el resto del listado trae URL', async () => {
    const { arr, inmuebleId } = await escenario();
    const otro = await crearInmueble(app, arr, `FIR3-${contador}`);
    for (const id of [inmuebleId, otro.id]) {
      await request(app.getHttpServer())
        .post(`/inmuebles/${id}/foto-portada`)
        .set('Authorization', `Bearer ${arr}`)
        .attach('foto', Buffer.from('portada jpeg'), {
          filename: 'p.jpg',
          contentType: 'image/jpeg',
        })
        .expect(OK);
    }
    for (const nombre of ['a.pdf', 'b.pdf']) {
      await request(app.getHttpServer())
        .post(`/inmuebles/${inmuebleId}/documentos`)
        .set('Authorization', `Bearer ${arr}`)
        .field('tipo', 'RECIBO_PREDIAL')
        .attach('archivo', Buffer.from(`doc ${nombre}`), {
          filename: nombre,
          contentType: 'application/pdf',
        })
        .expect(CREADO);
    }
    const portadas = await prisma.inmueble.findMany({
      where: { id: { in: [inmuebleId, otro.id] } },
    });
    const portadaRota =
      portadas.find((i) => i.id === inmuebleId)?.foto_portada_ruta ?? '';
    const documentos = await prisma.documentoInmueble.findMany({
      where: { inmueble_id: inmuebleId },
      orderBy: { creado_en: 'asc' },
    });
    capturarLogs();
    fallarEn([portadaRota, documentos[0].archivo_ruta ?? '']);

    const listado = (await get(arr, '/inmuebles').expect(OK)).body as Obj[];
    expect(listado).toHaveLength(2);
    expect(sinUrl(listado, 'foto_portada_url').map((x) => x.id)).toEqual([
      inmuebleId,
    ]);
    expect(conUrl(listado, 'foto_portada_url').map((x) => x.id)).toEqual([
      otro.id,
    ]);

    const detalle = (await get(arr, `/inmuebles/${inmuebleId}`).expect(OK))
      .body as Obj;
    expect(detalle.foto_portada_url).toBeNull();

    const docs = (
      await get(arr, `/inmuebles/${inmuebleId}/documentos`).expect(OK)
    ).body as Obj[];
    expect(docs).toHaveLength(2);
    expect(sinUrl(docs, 'archivo_url')).toHaveLength(1);
    expect(conUrl(docs, 'archivo_url')).toHaveLength(1);
    expect(JSON.stringify(docs)).not.toContain('archivo_ruta');

    jest.restoreAllMocks();
    sinUrlsEnLosLogs();
  }, 240000);

  // ------------------------------------------------------------------
  // Solicitudes de mantenimiento
  // ------------------------------------------------------------------
  it('solicitudes: un adjunto que no se puede firmar sale null en los listados del arrendador y del inquilino', async () => {
    const { arr, codigo, unidadId } = await escenario();
    const inq = await autenticarInquilino(
      app,
      codigo,
      `firma-sol-${contador}@correo.com`,
    );
    const crear = async (texto: string) =>
      (
        await request(app.getHttpServer())
          .post('/solicitudes-mantenimiento')
          .set('Authorization', `Bearer ${inq}`)
          .field('unidadId', unidadId)
          .field('descripcion', texto)
          .field('urgencia', 'ALTO')
          .attach('adjunto', Buffer.from(`evidencia ${texto}`), {
            filename: 'e.jpg',
            contentType: 'image/jpeg',
          })
          .expect(CREADO)
      ).body as { id: string };
    const s1 = await crear('Fuga uno');
    const s2 = await crear('Fuga dos');
    const filas = await prisma.solicitudMantenimiento.findMany();
    const rutaRota = filas.find((f) => f.id === s1.id)?.adjunto_ruta ?? '';
    capturarLogs();
    fallarEn([rutaRota]);

    const delArrendador = (
      await get(arr, '/solicitudes-mantenimiento').expect(OK)
    ).body as Obj[];
    expect(delArrendador).toHaveLength(2);
    expect(sinUrl(delArrendador, 'adjunto_url').map((x) => x.id)).toEqual([
      s1.id,
    ]);
    expect(conUrl(delArrendador, 'adjunto_url').map((x) => x.id)).toEqual([
      s2.id,
    ]);

    const delInquilino = (await get(inq, '/inquilino/solicitudes').expect(OK))
      .body as Obj[];
    expect(sinUrl(delInquilino, 'adjunto_url')).toHaveLength(1);
    const mias = (await get(inq, '/solicitudes-mantenimiento/mias').expect(OK))
      .body as Obj[];
    expect(sinUrl(mias, 'adjunto_url')).toHaveLength(1);
    const detalle = (
      await get(inq, `/inquilino/solicitudes/${s1.id}`).expect(OK)
    ).body as Obj;
    expect(detalle.adjunto_url).toBeNull();

    jest.restoreAllMocks();
    sinUrlsEnLosLogs();
  }, 240000);

  // ------------------------------------------------------------------
  // Fotos de inventario y panel del inquilino
  // ------------------------------------------------------------------
  it('inventario y panel del inquilino: una foto o el PDF heredado que no se puede firmar salen null; el detalle y el listado responden 200', async () => {
    const { arr, codigo, contratoId } = await escenario();
    const inq = await autenticarInquilino(
      app,
      codigo,
      `firma-panel-${contador}@correo.com`,
    );
    for (const zona of ['Cocina', 'Baño']) {
      await request(app.getHttpServer())
        .post(`/contratos/${contratoId}/fotos-inventario`)
        .set('Authorization', `Bearer ${arr}`)
        .field('momento', 'ENTREGA')
        .field('zona', zona)
        .attach('foto', Buffer.from(`foto ${zona}`), {
          filename: 'f.jpg',
          contentType: 'image/jpeg',
        })
        .expect(CREADO);
    }
    const fotos = await prisma.fotoInventario.findMany({
      where: { contrato_id: contratoId },
      orderBy: { creado_en: 'asc' },
    });
    const contrato = await prisma.contrato.findUniqueOrThrow({
      where: { id: contratoId },
    });
    capturarLogs();
    fallarEn([fotos[0].foto_ruta ?? '', contrato.pdf_contrato_ruta ?? '']);

    const lista = (
      await get(arr, `/contratos/${contratoId}/fotos-inventario`).expect(OK)
    ).body as Obj[];
    expect(lista).toHaveLength(2);
    expect(sinUrl(lista, 'foto_url')).toHaveLength(1);
    expect(conUrl(lista, 'foto_url')).toHaveLength(1);
    expect(JSON.stringify(lista)).not.toContain('foto_ruta');

    const detalle = (
      await get(inq, `/inquilino/contratos/${contratoId}`).expect(OK)
    ).body as {
      pdf_contrato_url: unknown;
      fotos_entrega: Obj[];
      documentos: Obj[];
    };
    expect(detalle.pdf_contrato_url).toBeNull();
    expect(detalle.fotos_entrega).toHaveLength(2);
    expect(sinUrl(detalle.fotos_entrega, 'foto_url')).toHaveLength(1);
    expect(conUrl(detalle.fotos_entrega, 'foto_url')).toHaveLength(1);
    expect(detalle.documentos.length).toBeGreaterThan(0);

    // El alias obsoleto usa el mismo servicio.
    const alias = (await get(inq, '/inquilino/mi-contrato').expect(OK))
      .body as Obj;
    expect(alias.pdf_contrato_url).toBeNull();

    jest.restoreAllMocks();
    sinUrlsEnLosLogs();
  }, 240000);
});
