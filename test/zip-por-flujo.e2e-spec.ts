import { archivoDePrueba } from './helpers/archivos.helper';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
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
import { leerZip } from './helpers/zip.helper';

const OK: number = HttpStatus.OK;
const CREADO: number = HttpStatus.CREATED;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;

const sha = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');
const espera = (ms: number) =>
  new Promise((resolver) => setTimeout(resolver, ms));

/** Espera (hasta `limiteMs`) a que se cumpla la condición. */
async function esperarHasta(condicion: () => boolean, limiteMs = 10000) {
  const inicio = Date.now();
  while (!condicion() && Date.now() - inicio < limiteMs) {
    await espera(50);
  }
}

describe('ZIP de documentos del inmueble por flujo (B-44, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;
  let contador = 0;
  // Lo que hay que soltar al terminar cada prueba para que app.close() no quede esperando.
  let limpiezas: Array<() => void> = [];

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
    limpiezas.forEach((limpiar) => limpiar());
    limpiezas = [];
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

  /**
   * Un inmueble con 2 documentos, un contrato con dos versiones del original y
   * un comprobante aprobado: 5 archivos en el ZIP.
   */
  async function inmuebleConArchivos() {
    contador += 1;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador Zip ${contador}`,
      `zip-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `ZIP-${contador}`);
    for (const nombre of ['certificado.pdf', 'predial.pdf']) {
      await request(app.getHttpServer())
        .post(`/inmuebles/${inmueble.id}/documentos`)
        .set('Authorization', `Bearer ${access_token}`)
        .field('tipo', 'RECIBO_PREDIAL')
        .attach('archivo', archivoDePrueba('pdf', `contenido de ${nombre}`), {
          filename: nombre,
          contentType: 'application/pdf',
        })
        .expect(CREADO);
    }
    const ficha = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      ficha.id,
    );
    // Corregir el contrato (aún sin vincular) crea la versión 2 del original.
    await request(app.getHttpServer())
      .patch(`/contratos/${contrato.id}`)
      .set('Authorization', `Bearer ${access_token}`)
      .send({ canon_centavos: 1234000 })
      .expect(OK);
    const inq = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      `zip-inq-${contador}@correo.com`,
    );
    const pago = await reportarPago(app, inq, contrato.id);
    await request(app.getHttpServer())
      .patch(`/pagos/${pago.id}/aprobar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(OK);
    return {
      token: access_token,
      inmuebleId: inmueble.id,
      contratoId: contrato.id,
    };
  }

  /** Archivos que debe traer el ZIP: nombre en el ZIP → ruta en el bucket. */
  async function esperados(inmuebleId: string, contratoId: string) {
    const corto = contratoId.slice(0, 8);
    const mapa = new Map<string, string>();
    const docs = await prisma.documentoInmueble.findMany({
      where: { inmueble_id: inmuebleId },
    });
    for (const d of docs) {
      mapa.set(
        `documentos-inmueble/${(d.archivo_ruta ?? '').split('/').pop()}`,
        d.archivo_ruta ?? '',
      );
    }
    for (const d of await prisma.documentoContrato.findMany({
      where: { contrato_id: contratoId },
    })) {
      mapa.set(`contratos/${corto}/v${d.version}-${d.tipo}.pdf`, d.ruta);
    }
    for (const p of await prisma.pago.findMany({
      where: { contrato_id: contratoId, estado: 'APROBADO' },
    })) {
      mapa.set(
        `comprobantes/${p.periodo.toISOString().slice(0, 10)}-${p.id.slice(0, 8)}-${(p.comprobante_ruta ?? '').split('/').pop()}`,
        p.comprobante_ruta ?? '',
      );
    }
    return mapa;
  }

  const descargar = (token: string, inmuebleId: string) =>
    request(app.getHttpServer())
      .get(`/inmuebles/${inmuebleId}/descargar-documentos`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  /** Descarga por HTTP real para observar cuándo llegan los bytes. */
  async function abrirDescarga(token: string, inmuebleId: string) {
    await app.listen(0);
    const servidor = app.getHttpServer() as unknown as http.Server;
    const puerto = (servidor.address() as AddressInfo).port;
    return new Promise<http.IncomingMessage>((resolver, rechazar) => {
      http
        .get(
          {
            port: puerto,
            path: `/inmuebles/${inmuebleId}/descargar-documentos`,
            headers: { Authorization: `Bearer ${token}` },
          },
          resolver,
        )
        .on('error', rechazar);
    });
  }

  // ------------------------------------------------------------------
  it('el ZIP trae los mismos archivos de siempre: mismos nombres, mismo contenido (hashes) y mismas cabeceras', async () => {
    const { token, inmuebleId, contratoId } = await inmuebleConArchivos();
    const esperado = await esperados(inmuebleId, contratoId);
    expect(esperado.size).toBe(5);

    const r = await descargar(token, inmuebleId).expect(OK);

    expect(r.headers['content-type']).toContain('application/zip');
    expect(r.headers['content-disposition']).toMatch(
      /^attachment; filename="documentos-.+\.zip"$/,
    );
    const zip = leerZip(r.body as Buffer);
    expect([...zip.keys()].sort()).toEqual([...esperado.keys()].sort());
    for (const [nombre, ruta] of esperado) {
      const enBucket = await almacenamiento.descargarArchivo(ruta);
      expect([nombre, sha(zip.get(nombre) ?? Buffer.alloc(0))]).toEqual([
        nombre,
        sha(enBucket),
      ]);
    }
    // Sin fallos no hay archivo de avisos.
    expect(zip.has('LEEME_ARCHIVOS_NO_DISPONIBLES.txt')).toBe(false);
  }, 120000);

  it('un archivo que falla al descargar se omite y queda listado en LEEME_ARCHIVOS_NO_DISPONIBLES.txt; el ZIP es válido con el resto', async () => {
    const { token, inmuebleId, contratoId } = await inmuebleConArchivos();
    const esperado = await esperados(inmuebleId, contratoId);
    const [nombreRoto, rutaRota] = [...esperado.entries()].find(([n]) =>
      n.includes('v2-CONTRATO_ORIGINAL'),
    ) as [string, string];
    const prototipo = Object.getPrototypeOf(
      almacenamiento,
    ) as AlmacenamientoService;
    jest
      .spyOn(almacenamiento, 'descargarArchivo')
      .mockImplementation(async (ruta: string) => {
        if (ruta === rutaRota) {
          throw new Error('descarga caída (simulada)');
        }
        return (await prototipo.descargarArchivo.call(
          almacenamiento,
          ruta,
        )) as Buffer;
      });

    const r = await descargar(token, inmuebleId).expect(OK);

    const zip = leerZip(r.body as Buffer);
    expect(zip.has(nombreRoto)).toBe(false);
    const presentes = [...zip.keys()].filter(
      (n) => n !== 'LEEME_ARCHIVOS_NO_DISPONIBLES.txt',
    );
    expect(presentes.sort()).toEqual(
      [...esperado.keys()].filter((n) => n !== nombreRoto).sort(),
    );
    const aviso = (
      zip.get('LEEME_ARCHIVOS_NO_DISPONIBLES.txt') ?? Buffer.alloc(0)
    ).toString('utf8');
    expect(aviso).toContain(nombreRoto);
    // Ni la ruta interna del bucket ni la URL firmada aparecen en el aviso.
    expect(aviso).not.toContain(rutaRota);
    expect(aviso).not.toMatch(/https?:\/\//);
  }, 120000);

  it('se envía por flujo: los primeros bytes llegan antes de que termine la descarga del último archivo', async () => {
    const { token, inmuebleId } = await inmuebleConArchivos();
    const prototipo = Object.getPrototypeOf(
      almacenamiento,
    ) as AlmacenamientoService;
    let llamadas = 0;
    let abrirPuerta: () => void = () => undefined;
    const puerta = new Promise<void>((resolver) => {
      abrirPuerta = resolver;
    });
    jest
      .spyOn(almacenamiento, 'descargarArchivo')
      .mockImplementation(async (ruta: string) => {
        llamadas += 1;
        // La segunda descarga queda detenida (almacenamiento lento).
        if (llamadas === 2) {
          await puerta;
        }
        return (await prototipo.descargarArchivo.call(
          almacenamiento,
          ruta,
        )) as Buffer;
      });

    const respuesta = await abrirDescarga(token, inmuebleId);
    limpiezas.push(abrirPuerta, () => respuesta.destroy());
    expect(respuesta.statusCode).toBe(OK);
    expect(respuesta.headers['content-type']).toContain('application/zip');
    const chunks: Buffer[] = [];
    const primerosBytes = new Promise<void>((resolver) => {
      respuesta.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        resolver();
      });
    });
    const resultado = await Promise.race([
      primerosBytes.then(() => 'bytes'),
      espera(10000).then(() => 'tiempo'),
    ]);

    // Con la segunda descarga detenida ya llegaron bytes al cliente.
    expect(resultado).toBe('bytes');
    await esperarHasta(() => llamadas >= 2);
    expect(llamadas).toBe(2);
    expect(chunks.length).toBeGreaterThan(0);

    const terminado = new Promise<void>((resolver) =>
      respuesta.on('end', resolver),
    );
    abrirPuerta();
    await terminado;

    const zip = leerZip(Buffer.concat(chunks));
    expect(zip.size).toBe(5);
    expect(llamadas).toBe(5);
  }, 120000);

  it('si el cliente corta la conexión, se aborta el ZIP y no se siguen descargando archivos', async () => {
    const { token, inmuebleId } = await inmuebleConArchivos();
    const prototipo = Object.getPrototypeOf(
      almacenamiento,
    ) as AlmacenamientoService;
    let llamadas = 0;
    let abrirPuerta: () => void = () => undefined;
    const puerta = new Promise<void>((resolver) => {
      abrirPuerta = resolver;
    });
    jest
      .spyOn(almacenamiento, 'descargarArchivo')
      .mockImplementation(async (ruta: string) => {
        llamadas += 1;
        if (llamadas === 2) {
          await puerta;
        }
        return (await prototipo.descargarArchivo.call(
          almacenamiento,
          ruta,
        )) as Buffer;
      });

    const respuesta = await abrirDescarga(token, inmuebleId);
    limpiezas.push(abrirPuerta, () => respuesta.destroy());
    await new Promise<void>((resolver) =>
      respuesta.once('data', () => resolver()),
    );
    await esperarHasta(() => llamadas >= 2);
    expect(llamadas).toBe(2);

    respuesta.destroy(); // el cliente se va
    await espera(300);
    abrirPuerta(); // la descarga detenida termina después de la desconexión
    await espera(1500);

    // No se pidió ningún archivo más después de la desconexión.
    expect(llamadas).toBe(2);
  }, 120000);

  it('la pertenencia se valida antes de enviar bytes: ajeno, inexistente o id inválido = 404 sin cabeceras de ZIP', async () => {
    const { inmuebleId } = await inmuebleConArchivos();
    const otro = await registrarArrendador(
      app,
      'Otro Arrendador',
      `otro-zip-${contador}@correo.com`,
    );
    const descargarSpy = jest.spyOn(almacenamiento, 'descargarArchivo');

    for (const id of [
      inmuebleId,
      '00000000-0000-4000-8000-000000000000',
      'no-es-un-id',
    ]) {
      const r = await request(app.getHttpServer())
        .get(`/inmuebles/${id}/descargar-documentos`)
        .set('Authorization', `Bearer ${otro.access_token}`);
      expect([id, r.status]).toEqual([id, NO_ENCONTRADO]);
      expect(r.headers['content-type']).not.toContain('application/zip');
      expect(r.headers['content-disposition']).toBeUndefined();
    }
    expect(descargarSpy).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get(`/inmuebles/${inmuebleId}/descargar-documentos`)
      .expect(HttpStatus.UNAUTHORIZED);
  }, 120000);
});
