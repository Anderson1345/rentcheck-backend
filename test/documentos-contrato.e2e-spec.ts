import { archivoDePrueba } from './helpers/archivos.helper';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { AppModule } from '../src/app.module';
import {
  sumarDiasUTC,
  sumarMesesUTC,
} from '../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../src/common/hoy-bogota.util';
import { configurarApp } from '../src/configurar-app';
import { DocumentoContratoService } from '../src/contrato/documento-contrato.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface DocumentoListado {
  id: string;
  tipo: string;
  version: number;
  generado_en: string;
  hash_sha256: string | null;
  url_firmada: string;
  ruta?: string;
}

interface RespuestaRegenerar {
  generados: Array<{ tipo: string; version: number }>;
  ya_existian: number;
}

const CREADO: number = HttpStatus.CREATED;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;
const NO_AUTORIZADO: number = HttpStatus.UNAUTHORIZED;
const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;

function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Nombres de las entradas de un ZIP, leídos del directorio central. */
function nombresDelZip(zip: Buffer): string[] {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) {
    eocd -= 1;
  }
  const total = zip.readUInt16LE(eocd + 10);
  let posicion = zip.readUInt32LE(eocd + 16);
  const nombres: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const largoNombre = zip.readUInt16LE(posicion + 28);
    const largoExtra = zip.readUInt16LE(posicion + 30);
    const largoComentario = zip.readUInt16LE(posicion + 32);
    nombres.push(
      zip.toString('utf8', posicion + 46, posicion + 46 + largoNombre),
    );
    posicion += 46 + largoNombre + largoExtra + largoComentario;
  }
  return nombres;
}

describe('Documentos del contrato (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;
  let documentos: DocumentoContratoService;
  let contadorSufijo = 0;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    almacenamiento = moduleFixture.get(AlmacenamientoService);
    documentos = moduleFixture.get(DocumentoContratoService);
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  /**
   * Contrato de 13 meses de antigüedad con vencimiento en 60 días: puede
   * recibir un incremento (12 meses cumplidos) y una prórroga (ventana de 90
   * días) el mismo día.
   */
  async function prepararContrato(
    opciones: {
      canon?: number;
      inicioMesesAtras?: number;
      /** El almacenamiento falla desde antes de crear el contrato. */
      almacenamientoCaido?: boolean;
    } = {},
  ) {
    contadorSufijo += 1;
    const subirCaido = opciones.almacenamientoCaido
      ? jest
          .spyOn(almacenamiento, 'subirArchivo')
          .mockRejectedValue(new Error('storage caído'))
      : null;
    const hoy = hoyEnBogota();
    const { access_token, arrendador } = await registrarArrendador(
      app,
      `Arrendador ${contadorSufijo}`,
      `docs-${contadorSufijo}@correo.com`,
    );
    const inmueble = await crearInmueble(
      app,
      access_token,
      `DOC-${contadorSufijo}`,
    );
    const inquilino = await crearInquilino(app, access_token);
    const finOriginal = sumarDiasUTC(hoy, 60);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
      {
        fecha_inicio: fechaISO(
          sumarMesesUTC(hoy, -(opciones.inicioMesesAtras ?? 13)),
        ),
        fecha_fin: fechaISO(finOriginal),
        canon_centavos: opciones.canon ?? 1_000_000,
      },
    );
    return {
      access_token,
      arrendadorId: arrendador.id,
      inmueble,
      contrato,
      finOriginal,
      subirCaido,
    };
  }

  async function configurarIpc(porcentaje = 5.1) {
    await prisma.configuracionIpc.create({
      data: { anio: hoyEnBogota().getUTCFullYear() - 1, porcentaje },
    });
  }

  const aplicarIncremento = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/contratos/${id}/aplicar-incremento`)
      .set('Authorization', `Bearer ${token}`);

  const prorrogar = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/contratos/${id}/prorrogar`)
      .set('Authorization', `Bearer ${token}`);

  const regenerar = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/contratos/${id}/documentos/regenerar`)
      .set('Authorization', `Bearer ${token}`);

  const listarDocumentos = (token: string, id: string) =>
    request(app.getHttpServer())
      .get(`/contratos/${id}/documentos`)
      .set('Authorization', `Bearer ${token}`);

  const documentosEnBd = (contratoId: string) =>
    prisma.documentoContrato.findMany({
      where: { contrato_id: contratoId },
      orderBy: { version: 'asc' },
    });

  it('al crear el contrato guarda el original v1 con hash SHA-256, ruta versionada y upsert=false', async () => {
    const subir = jest.spyOn(almacenamiento, 'subirArchivo');
    const { contrato } = await prepararContrato();

    const rutaEsperada = `contratos/${contrato.id}/v1-CONTRATO_ORIGINAL.pdf`;
    const filas = await documentosEnBd(contrato.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tipo: 'CONTRATO_ORIGINAL',
      version: 1,
      ruta: rutaEsperada,
      incremento_id: null,
      prorroga_id: null,
    });
    expect(filas[0].hash_sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(subir).toHaveBeenCalledTimes(1);
    const [buffer, ruta, mime, upsert] = subir.mock.calls[0];
    expect(ruta).toBe(rutaEsperada);
    expect(mime).toBe('application/pdf');
    expect(upsert).toBe(false);
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(
      filas[0].hash_sha256,
    );

    const enBd = await prisma.contrato.findUniqueOrThrow({
      where: { id: contrato.id },
    });
    expect(enBd.pdf_contrato_ruta).toBe(rutaEsperada);
    expect(contrato.pdf_contrato_url).toMatch(URL_FIRMADA);
  }, 30000);

  it('GET /contratos/:id/documentos lista versiones con URL firmada y sin rutas internas', async () => {
    await configurarIpc();
    const { access_token, contrato } = await prepararContrato();
    await aplicarIncremento(access_token, contrato.id).expect(CREADO);

    const respuesta = await listarDocumentos(access_token, contrato.id).expect(
      HttpStatus.OK,
    );
    const lista = respuesta.body as DocumentoListado[];

    expect(lista.map((d) => [d.version, d.tipo])).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'OTROSI_INCREMENTO'],
    ]);
    for (const documento of lista) {
      expect(documento.url_firmada).toMatch(URL_FIRMADA);
      expect(documento.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(documento.generado_en).toBeTruthy();
      expect(documento).not.toHaveProperty('ruta');
    }
  }, 30000);

  it('un incremento crea el otrosí v2 vinculado y no toca el original', async () => {
    await configurarIpc();
    const { access_token, contrato } = await prepararContrato();
    const [original] = await documentosEnBd(contrato.id);

    const respuesta = await aplicarIncremento(access_token, contrato.id).expect(
      CREADO,
    );
    const cuerpo = respuesta.body as {
      contrato: unknown;
      incremento_ipc: { id: string };
    };
    expect(Object.keys(cuerpo).sort()).toEqual(['contrato', 'incremento_ipc']);

    const filas = await documentosEnBd(contrato.id);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toEqual(original);
    expect(filas[1]).toMatchObject({
      tipo: 'OTROSI_INCREMENTO',
      version: 2,
      incremento_id: cuerpo.incremento_ipc.id,
      prorroga_id: null,
      ruta: `contratos/${contrato.id}/v2-OTROSI_INCREMENTO.pdf`,
    });
    expect(filas[1].hash_sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 30000);

  it('una prórroga crea el siguiente otrosí y los versionados siguen el orden de los hechos', async () => {
    await configurarIpc();
    const { access_token, contrato } = await prepararContrato();

    await aplicarIncremento(access_token, contrato.id).expect(CREADO);
    const prorrogaRespuesta = await prorrogar(access_token, contrato.id).expect(
      CREADO,
    );
    const prorrogaId = (prorrogaRespuesta.body as { prorroga: { id: string } })
      .prorroga.id;

    const filas = await documentosEnBd(contrato.id);
    expect(filas.map((d) => [d.version, d.tipo])).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'OTROSI_INCREMENTO'],
      [3, 'OTROSI_PRORROGA'],
    ]);
    expect(filas[2].prorroga_id).toBe(prorrogaId);
  }, 30000);

  it('si falla la subida del otrosí el incremento queda aplicado, no hay fila y regenerar la crea después', async () => {
    await configurarIpc();
    const { access_token, contrato } = await prepararContrato();
    jest
      .spyOn(almacenamiento, 'subirArchivo')
      .mockRejectedValueOnce(new Error('storage caído'));

    await aplicarIncremento(access_token, contrato.id).expect(CREADO);

    expect(await prisma.incrementoIPC.count()).toBe(1);
    expect(await documentosEnBd(contrato.id)).toHaveLength(1);

    const respuesta = await regenerar(access_token, contrato.id).expect(CREADO);
    expect(respuesta.body).toEqual({
      generados: [{ tipo: 'OTROSI_INCREMENTO', version: 2 }],
      ya_existian: 1,
    });
    expect(await documentosEnBd(contrato.id)).toHaveLength(2);
  }, 30000);

  it('si falla la fila tras subir el archivo, borra el archivo huérfano y no deja documento', async () => {
    const { access_token, contrato, subirCaido } = await prepararContrato({
      almacenamientoCaido: true,
    });
    subirCaido?.mockRestore();
    expect(await documentosEnBd(contrato.id)).toHaveLength(0);
    const eliminar = jest.spyOn(almacenamiento, 'eliminarArchivo');
    jest
      .spyOn(documentos, 'insertarFila')
      .mockRejectedValue(new Error('BD caída'));

    await regenerar(access_token, contrato.id).expect(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    expect(await documentosEnBd(contrato.id)).toHaveLength(0);
    expect(eliminar).toHaveBeenCalledWith(
      `contratos/${contrato.id}/v1-CONTRATO_ORIGINAL.pdf`,
    );
  }, 30000);

  // ------------------------------------------------------------------
  // TEST-FIRST: el original se reconstruye con los términos ORIGINALES.
  // ------------------------------------------------------------------
  it('regenerar reconstruye el original con el canon y la fecha de fin ORIGINALES y respeta el orden cronológico', async () => {
    await configurarIpc();
    // Todo el almacenamiento falla: no hay original ni otrosíes.
    const { access_token, contrato, finOriginal, subirCaido } =
      await prepararContrato({ almacenamientoCaido: true });

    await aplicarIncremento(access_token, contrato.id).expect(CREADO);
    const prorrogaRespuesta = await prorrogar(access_token, contrato.id).expect(
      CREADO,
    );
    const finNueva = fechaISO(
      new Date(
        (prorrogaRespuesta.body as { contrato: { fecha_fin: string } }).contrato
          .fecha_fin,
      ),
    );
    expect(await documentosEnBd(contrato.id)).toHaveLength(0);
    expect(finNueva).not.toBe(fechaISO(finOriginal));

    subirCaido?.mockRestore();
    const generarPdf = jest.spyOn(documentos, 'generarPdf');
    const respuesta = await regenerar(access_token, contrato.id).expect(CREADO);

    expect(respuesta.body).toEqual({
      generados: [
        { tipo: 'CONTRATO_ORIGINAL', version: 1 },
        { tipo: 'OTROSI_INCREMENTO', version: 2 },
        { tipo: 'OTROSI_PRORROGA', version: 3 },
      ],
      ya_existian: 0,
    });

    const textoOriginal = generarPdf.mock.calls[0][0];
    expect(textoOriginal).toContain('$10.000');
    expect(textoOriginal).not.toContain('$10.510');
    expect(textoOriginal).toContain(`hasta el ${fechaISO(finOriginal)}`);
    expect(textoOriginal).not.toContain(finNueva);

    const enBd = await prisma.contrato.findUniqueOrThrow({
      where: { id: contrato.id },
    });
    expect(enBd.pdf_contrato_ruta).toBe(
      `contratos/${contrato.id}/v1-CONTRATO_ORIGINAL.pdf`,
    );
  }, 60000);

  // ------------------------------------------------------------------
  // TEST-FIRST: regenerar nunca sobrescribe ni borra lo que ya existe.
  // ------------------------------------------------------------------
  it('regenerar es idempotente: la segunda vez no genera nada y no toca los documentos existentes', async () => {
    await configurarIpc();
    const { access_token, contrato } = await prepararContrato();
    await aplicarIncremento(access_token, contrato.id).expect(CREADO);
    // Un documento heredado: existe pero sin hash.
    await prisma.documentoContrato.updateMany({
      where: { contrato_id: contrato.id, version: 1 },
      data: { hash_sha256: null },
    });
    const antes = await documentosEnBd(contrato.id);

    const subir = jest.spyOn(almacenamiento, 'subirArchivo');
    const eliminar = jest.spyOn(almacenamiento, 'eliminarArchivo');
    const primera = await regenerar(access_token, contrato.id).expect(CREADO);
    const segunda = await regenerar(access_token, contrato.id).expect(CREADO);

    expect(primera.body).toEqual({ generados: [], ya_existian: 2 });
    expect(segunda.body).toEqual({ generados: [], ya_existian: 2 });
    expect(subir).not.toHaveBeenCalled();
    expect(eliminar).not.toHaveBeenCalled();
    expect(await documentosEnBd(contrato.id)).toEqual(antes);
  }, 30000);

  it('regenerar en paralelo no duplica documentos', async () => {
    await configurarIpc();
    const { access_token, contrato, subirCaido } = await prepararContrato({
      almacenamientoCaido: true,
    });
    await aplicarIncremento(access_token, contrato.id).expect(CREADO);
    subirCaido?.mockRestore();

    const respuestas = await Promise.all([
      regenerar(access_token, contrato.id),
      regenerar(access_token, contrato.id),
      regenerar(access_token, contrato.id),
    ]);

    for (const respuesta of respuestas) {
      expect(respuesta.status).toBe(CREADO);
    }
    const generadosTotal = respuestas.flatMap(
      (r) => (r.body as RespuestaRegenerar).generados,
    );
    expect(generadosTotal).toHaveLength(2);
    const filas = await documentosEnBd(contrato.id);
    expect(filas.map((d) => [d.version, d.tipo])).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'OTROSI_INCREMENTO'],
    ]);
  }, 60000);

  it('un contrato ajeno o inexistente responde 404 en GET y POST; el inquilino no puede usar los endpoints', async () => {
    const dueno = await prepararContrato();
    const { access_token: otroToken } = await registrarArrendador(
      app,
      'Otro Arrendador',
      'otro-docs@correo.com',
    );

    await listarDocumentos(otroToken, dueno.contrato.id).expect(NO_ENCONTRADO);
    await regenerar(otroToken, dueno.contrato.id).expect(NO_ENCONTRADO);
    await listarDocumentos(
      dueno.access_token,
      '00000000-0000-4000-8000-000000000000',
    ).expect(NO_ENCONTRADO);
    expect(await documentosEnBd(dueno.contrato.id)).toHaveLength(1);

    const inquilinoToken = await autenticarInquilino(
      app,
      dueno.contrato.codigo_acceso?.codigo ?? '',
      'inquilino-docs@correo.com',
    );
    await listarDocumentos(inquilinoToken, dueno.contrato.id).expect(
      NO_AUTORIZADO,
    );
    await regenerar(inquilinoToken, dueno.contrato.id).expect(NO_AUTORIZADO);
  }, 30000);

  it('el ZIP incluye todas las versiones y solo los comprobantes APROBADOS, sin colisiones de nombre', async () => {
    await configurarIpc();
    const { access_token, inmueble, contrato } = await prepararContrato();
    await aplicarIncremento(access_token, contrato.id).expect(CREADO);
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'inquilino-zip@correo.com',
    );

    const hoy = hoyEnBogota();
    const periodos = [-2, -1, 0].map(
      (meses) =>
        new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + meses, 1)),
    );
    const pagos: string[] = [];
    for (const periodo of periodos) {
      const respuesta = await request(app.getHttpServer())
        .post('/pagos')
        .set('Authorization', `Bearer ${inquilinoToken}`)
        .field('contratoId', contrato.id)
        .field('monto_centavos', '1000000')
        .field('fecha_reportada', fechaISO(hoy))
        .field('periodo', fechaISO(periodo))
        .attach(
          'comprobante',
          archivoDePrueba('png', 'comprobante de prueba'),
          {
            filename: 'comprobante.png',
            contentType: 'image/png',
          },
        )
        .expect(CREADO);
      pagos.push((respuesta.body as { id: string }).id);
    }
    const [aprobado1, aprobado2, rechazado] = pagos;
    const pendiente = (
      await request(app.getHttpServer())
        .post('/pagos')
        .set('Authorization', `Bearer ${inquilinoToken}`)
        .field('contratoId', contrato.id)
        .field('monto_centavos', '1000000')
        .field('fecha_reportada', fechaISO(hoy))
        .field('periodo', fechaISO(sumarMesesUTC(periodos[0], -1)))
        .attach(
          'comprobante',
          archivoDePrueba('png', 'comprobante de prueba'),
          {
            filename: 'comprobante.png',
            contentType: 'image/png',
          },
        )
        .expect(CREADO)
    ).body as { id: string };

    for (const id of [aprobado1, aprobado2]) {
      await request(app.getHttpServer())
        .patch(`/pagos/${id}/aprobar`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.OK);
    }
    await request(app.getHttpServer())
      .patch(`/pagos/${rechazado}/rechazar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    // Dos comprobantes aprobados con el MISMO nombre de archivo en carpetas
    // distintas: el ZIP no debe pisar uno con otro.
    for (const [indice, id] of [aprobado1, aprobado2].entries()) {
      const ruta = `pagos/${contrato.id}/colision-${indice}/comprobante.png`;
      await almacenamiento.subirArchivo(
        Buffer.from(`comprobante ${indice}`),
        ruta,
        'image/png',
        true,
      );
      await prisma.pago.update({
        where: { id },
        data: { comprobante_ruta: ruta },
      });
    }

    const zip = await request(app.getHttpServer())
      .get(`/inmuebles/${inmueble.id}/descargar-documentos`)
      .set('Authorization', `Bearer ${access_token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(HttpStatus.OK);
    const nombres = nombresDelZip(zip.body as Buffer);
    const corto = (id: string) => id.slice(0, 8);

    expect(nombres).toContain(
      `contratos/${corto(contrato.id)}/v1-CONTRATO_ORIGINAL.pdf`,
    );
    expect(nombres).toContain(
      `contratos/${corto(contrato.id)}/v2-OTROSI_INCREMENTO.pdf`,
    );

    const comprobantes = nombres.filter((n) => n.startsWith('comprobantes/'));
    expect(comprobantes).toHaveLength(2);
    expect(new Set(comprobantes).size).toBe(2);
    expect(comprobantes.some((n) => n.includes(corto(aprobado1)))).toBe(true);
    expect(comprobantes.some((n) => n.includes(corto(aprobado2)))).toBe(true);
    expect(comprobantes.some((n) => n.includes(corto(rechazado)))).toBe(false);
    expect(comprobantes.some((n) => n.includes(corto(pendiente.id)))).toBe(
      false,
    );
    expect(comprobantes[0]).toMatch(
      /^comprobantes\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}-comprobante\.png$/,
    );
  }, 90000);
});
